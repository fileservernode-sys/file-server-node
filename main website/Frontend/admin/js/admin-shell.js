/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — SPA SHELL & OPERATIONS UI MANAGER
 * Phase 7.5-E & Phase 8.7: Canonical Light Operations Console
 */

(function (window) {
  'use strict';

  /**
   * AUTHORITATIVE ZDEXCLOUD ADMIN CONTROL PLANE MODULE REGISTRY
   * Authoritative source of truth for implementation state across all roadmap phases.
   */
  const MODULE_REGISTRY = [
    // --- Phase 7: Security & Admin Foundation ---
    {
      id: 'admin-roles',
      name: 'Roles & RBAC Matrix',
      category: 'Security & Access',
      route: '#admin-roles',
      permission: 'admin_roles.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 7',
      description: 'Role-based access control, privilege catalogs, and administrator assignments.',
      apiNamespace: '/api/v1/admin/auth/*',
      icon: 'shield'
    },
    {
      id: 'audit-logs',
      name: 'Security Audit Logs',
      category: 'Security & Access',
      route: '#audit-logs',
      permission: 'audit.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 7',
      description: 'Tamper-evident, cryptographically chained SHA-256 administrative event logs.',
      apiNamespace: '/api/v1/admin/audit/*',
      icon: 'file-text'
    },

    // --- Phase 8: Core Operations ---
    {
      id: 'users',
      name: 'Customer Accounts',
      category: 'Core Operations',
      route: '#users',
      permission: 'users.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 8',
      description: 'Customer directory, identity verification, account suspension, and session revocation.',
      apiNamespace: '/api/v1/admin/operations/users/*',
      icon: 'users'
    },
    {
      id: 'devices',
      name: 'Devices & Nodes',
      category: 'Core Operations',
      route: '#devices',
      permission: 'devices.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 8',
      description: 'Registered hardware edge nodes, platform telemetry, and session disconnect controls.',
      apiNamespace: '/api/v1/admin/operations/devices/*',
      icon: 'server'
    },
    {
      id: 'servers',
      name: 'Server Instances',
      category: 'Core Operations',
      route: '#servers',
      permission: 'servers.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 8',
      description: 'Local file server daemons, health status, and administrative power controls.',
      apiNamespace: '/api/v1/admin/operations/servers/*',
      icon: 'hard-drive'
    },
    {
      id: 'gateway',
      name: 'Gateway & Relays',
      category: 'Core Operations',
      route: '#gateway',
      permission: 'gateway.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 8',
      description: 'Edge relay clusters, WebSocket tunnels, node drain controls, and diagnostics.',
      apiNamespace: '/api/v1/admin/operations/gateway/*',
      icon: 'radio'
    },

    // --- Phase 9: Commercial & Billing Operations ---
    {
      id: 'billing-overview',
      name: 'Financial & Billing Overview',
      category: 'Commercial & Billing',
      route: '#billing-overview',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Consolidated commercial telemetry, revenue volume, and reconciliation health.',
      apiNamespace: '/api/v1/admin/operations/billing/overview',
      icon: 'dashboard'
    },
    {
      id: 'subscriptions',
      name: 'Subscriptions & Dunning',
      category: 'Commercial & Billing',
      route: '#subscriptions',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Subscription lifecycle management, dunning triage, and administrative cancellations.',
      apiNamespace: '/api/v1/admin/operations/billing/subscriptions/*',
      icon: 'credit-card'
    },
    {
      id: 'payments',
      name: 'Payments & Transactions',
      category: 'Commercial & Billing',
      route: '#payments',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Payment transaction ledger, provider synchronization, and tax/fee breakdowns.',
      apiNamespace: '/api/v1/admin/operations/billing/payments/*',
      icon: 'dollar-sign'
    },
    {
      id: 'refunds',
      name: 'Refunds & Returns',
      category: 'Commercial & Billing',
      route: '#refunds',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Administrative refund execution, partial refund tracking, and idempotency guards.',
      apiNamespace: '/api/v1/admin/operations/billing/refunds/*',
      icon: 'rotate-ccw'
    },
    {
      id: 'reconciliation',
      name: 'Billing Reconciliation & Drift',
      category: 'Commercial & Billing',
      route: '#reconciliation',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Provider reconciliation batch runs, drift detection, and discrepancy resolution.',
      apiNamespace: '/api/v1/admin/operations/billing/reconciliation/*',
      icon: 'git-compare'
    },
    {
      id: 'settlements',
      name: 'Settlements & Payouts',
      category: 'Commercial & Billing',
      route: '#settlements',
      permission: 'billing.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 9',
      description: 'Bank payout batch tracking, provider fee deductions, and net credit verification.',
      apiNamespace: '/api/v1/admin/operations/billing/settlements/*',
      icon: 'database'
    },

    // --- Phase 10: Customer Support Operations ---
    {
      id: 'support-cases',
      name: 'Support Cases & Help Desk',
      category: 'Customer Support',
      route: '#support-cases',
      permission: 'support.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 10',
      description: 'Customer support tickets, case triage, bounded customer diagnostic projections, and internal operator notes.',
      apiNamespace: '/api/v1/admin/operations/support/*',
      icon: 'life-buoy'
    },

    // --- Future Scheduled Modules (Honest Roadmap Tracking) ---
    {
      id: 'communication-infra',
      name: 'Communication & Push Relays',
      category: 'Infrastructure',
      route: null,
      permission: 'communication.read',
      status: 'FUTURE',
      phase: 'Phase 11',
      description: 'Notification dispatch, push notification delivery, and outbound messaging queues.',
      apiNamespace: 'Scheduled for Phase 11',
      icon: 'radio'
    },
    {
      id: 'gateway-resilience',
      name: 'Gateway Self-Healing & Failover',
      category: 'Infrastructure',
      route: null,
      permission: 'gateway.admin',
      status: 'FUTURE',
      phase: 'Phase 11A',
      description: 'Automated relay failover, circuit breaking, and distributed tunnel recovery.',
      apiNamespace: 'Scheduled for Phase 11A',
      icon: 'refresh-cw'
    },
    {
      id: 'observability-center',
      name: 'Observability & Error Center',
      category: 'Observability & Diagnostics',
      route: '#observability-center',
      permission: 'errors.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 12',
      description: 'Centralized operational error aggregation, incident triage, and diagnostic telemetry.',
      apiNamespace: '/api/v1/admin/errors/*',
      icon: 'alert-triangle'
    },
    {
      id: 'email-operations',
      name: 'Email Operations & Analytics',
      category: 'Observability & Diagnostics',
      route: '#email-operations',
      permission: 'emails.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 13',
      description: 'Centralized outbound email delivery tracking, daily analytics, failure & bounce breakdowns, and transport telemetry.',
      apiNamespace: '/api/v1/admin/emails/*',
      icon: 'mail'
    },
    {
      id: 'database',
      name: 'Database Management',
      category: 'System & Data',
      route: '#database',
      permission: 'database.management.view',
      status: 'IMPLEMENTED',
      phase: 'Phase 15',
      description: 'Database topology, schema discovery, table inspection, and bounded table browsing.',
      apiNamespace: '/api/v1/admin/database/*',
      icon: 'database'
    },
    {
      id: 'sql-runner',
      name: 'SQL Query Runner',
      category: 'System & Data',
      route: '#sql-runner',
      permission: 'sql.query.read',
      status: 'IMPLEMENTED',
      phase: 'Phase 15',
      description: 'Read-only administrative SQL query execution with sensitive data masking and immutable audit logging.',
      apiNamespace: '/api/v1/admin/sql/*',
      icon: 'database'
    },
    {
      id: 'system-settings',
      name: 'System Settings & Config',
      category: 'System & Data',
      route: null,
      permission: 'system.admin',
      status: 'FUTURE',
      phase: 'Phase 16',
      description: 'Platform runtime configuration, feature flags, and maintenance mode toggles.',
      apiNamespace: 'Scheduled for Phase 16',
      icon: 'server'
    }
  ];

  const NAV_SCHEMA = [
    {
      group: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Operations Overview',
          icon: 'dashboard',
          permission: null
        }
      ]
    },
    {
      group: 'Core Operations',
      items: [
        {
          id: 'users',
          label: 'Customer Accounts',
          icon: 'users',
          permission: 'users.read'
        },
        {
          id: 'devices',
          label: 'Devices & Nodes',
          icon: 'server',
          permission: 'devices.read'
        },
        {
          id: 'servers',
          label: 'Server Instances',
          icon: 'hard-drive',
          permission: 'servers.read'
        },
        {
          id: 'gateway',
          label: 'Gateway & Relays',
          icon: 'radio',
          permission: 'gateway.read'
        }
      ]
    },
    {
      group: 'Commercial & Billing',
      items: [
        {
          id: 'billing-overview',
          label: 'Financial & Billing Overview',
          icon: 'dashboard',
          permission: 'billing.read'
        },
        {
          id: 'subscriptions',
          label: 'Subscriptions & Dunning',
          icon: 'credit-card',
          permission: 'billing.read'
        },
        {
          id: 'payments',
          label: 'Payments & Transactions',
          icon: 'dollar-sign',
          permission: 'billing.read'
        },
        {
          id: 'refunds',
          label: 'Refunds & Returns',
          icon: 'rotate-ccw',
          permission: 'billing.read'
        },
        {
          id: 'reconciliation',
          label: 'Billing Reconciliation & Drift',
          icon: 'git-compare',
          permission: 'billing.read'
        },
        {
          id: 'settlements',
          label: 'Settlements & Payouts',
          icon: 'database',
          permission: 'billing.read'
        }
      ]
    },
    {
      group: 'Customer Support',
      items: [
        {
          id: 'support-cases',
          label: 'Support Cases & Desk',
          icon: 'life-buoy',
          permission: 'support.read'
        }
      ]
    },
    {
      group: 'Observability & Health',
      items: [
        {
          id: 'observability-center',
          label: 'Error & Incident Center',
          icon: 'alert-triangle',
          permission: 'errors.read'
        },
        {
          id: 'email-operations',
          label: 'Email Operations',
          icon: 'mail',
          permission: 'emails.read'
        }
      ]
    },
    {
      group: 'Security & Access',
      items: [
        {
          id: 'admin-roles',
          label: 'Roles & RBAC Matrix',
          icon: 'shield',
          permission: 'admin_roles.read'
        },
        {
          id: 'audit-logs',
          label: 'Security Audit Logs',
          icon: 'file-text',
          permission: 'audit.read'
        }
      ]
    },
    {
      group: 'Developer Tools',
      items: [
        {
          id: 'database',
          label: 'Database Management',
          icon: 'database',
          permission: 'database.management.view'
        },
        {
          id: 'sql-runner',
          label: 'SQL Query Runner',
          icon: 'database',
          permission: 'sql.query.read'
        }
      ]
    }
  ];

  const ICONS = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    'alert-triangle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    'life-buoy': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" x2="9.17" y1="4.93" y2="9.17"/><line x1="14.83" x2="19.07" y1="14.83" y2="19.07"/><line x1="14.83" x2="19.07" y1="9.17" y2="4.93"/><line x1="14.83" x2="9.17" y1="14.83" y2="19.07"/></svg>',
    'message-square': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'git-compare': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/></svg>',
    'credit-card': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
    'dollar-sign': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    'rotate-ccw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
    'hard-drive': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    'file-text': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    'refresh-cw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon" style="width:14px;height:14px;" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-search-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;color:var(--admin-warning);"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>'
  };

  class AdminShellManager {
    constructor() {
      this.currentSection = 'dashboard';
      this.gatewayActiveTab = 'nodes';
      this.idleSecondsRemaining = 900;
      this.idleTimerInterval = null;

      // Module State Caches
      this.userState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.deviceState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', platform: '' };
      this.serverState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.gatewayState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.connectionsState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.subscriptionState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', planCode: '' };
      this.paymentState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', currency: '' };
      this.refundState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', reason: '' };
      this.reconciliationState = { page: 1, pageSize: 20, total: 0, items: [], status: '', activeTab: 'runs' };
      this.discrepancyState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', discrepancyType: '' };
      this.settlementState = { page: 1, pageSize: 20, total: 0, items: [], search: '', reconciliationStatus: '' };
      this.supportState = {
        page: 1,
        pageSize: 20,
        total: 0,
        items: [],
        search: '',
        status: '',
        priority: '',
        category: '',
        assignedAdminId: '',
        unassigned: false,
        needsAttention: false,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      };
      this.supportActiveTab = 'cases';
      this.supportCustomerState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.auditState = { page: 1, limit: 20, total: 0, items: [], search: '', status: '', action: '', startDate: '', endDate: '' };
      this.errorCenterState = {
        page: 1,
        pageSize: 25,
        total: 0,
        totalPages: 0,
        items: [],
        search: '',
        status: '',
        severity: '',
        component: '',
        errorCode: '',
        startDate: '',
        endDate: '',
        sortBy: 'updatedAt',
        sortOrder: 'desc'
      };
      this.emailOperationsState = {
        days: 7,
        analytics: null,
        recentEmails: [],
        recentFailures: [],
        isLoading: false,
        error: null
      };
      this.sqlResultState = {
        rows: [],
        columns: [],
        totalCount: 0,
        filteredRows: [],
        filterText: '',
        executionTimeMs: 0,
        statementType: '',
        truncated: false,
        hasExecuted: false
      };
      this.sqlHistoryState = {
        entries: [],
        filterText: '',
        statusFilter: 'ALL',
        expandedIds: new Set()
      };
      this.sqlSavedQueriesState = {
        queries: [],
        filterText: '',
        expandedIds: new Set()
      };
      this.sqlMode = 'READ_ONLY'; // 'READ_ONLY' | 'CONTROLLED_WRITE'
      this.dbManagementState = {
        overview: null,
        tables: [],
        selectedTable: null,
        tableDetails: null,
        previewData: null,
        gridData: null,
        activeTab: 'grid', // 'grid' | 'columns' | 'indexes'
        filterText: '',
        classificationFilter: 'ALL',
        // Grid Specific State
        page: 1,
        pageSize: 25,
        sortBy: null,
        sortDirection: 'asc',
        searchQuery: '',
        filters: [], // Array of { column, operator, value }
        selectedRowKeys: new Set(), // Set of canonical row identity keys
        selectedRowsMeta: new Map(), // Map of canonicalKey -> { table, primaryKey, noPrimaryKey }
        selectionLimit: 500, // Maximum client-side selected rows limit
        isLoadingOverview: false,
        isLoadingTables: false,
        isLoadingDetails: false,
        isLoadingGrid: false,
        requestId: 0,
        searchDebounceTimer: null,
        error: null
      };
    }


    async init() {
      const authed = await window.AdminAuth.requireAuthGuard();
      if (!authed) return;

      this._renderHeaderProfile();
      this._renderSidebar();
      this._bindEventListeners();
      this._startIdleCountdown();
      this._handleHashRoute();
    }

    _renderHeaderProfile() {
      const user = window.AdminAuth.currentUser;
      const roles = window.AdminAuth.roles;
      if (!user) return;

      const initials = (user.fullName || user.email || 'A')
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      const avatarEl = document.getElementById('adminAvatarInitials');
      if (avatarEl) avatarEl.textContent = initials;

      const headerNameEl = document.getElementById('adminHeaderName');
      if (headerNameEl) headerNameEl.textContent = user.fullName || user.email;

      const sidebarNameEl = document.getElementById('adminSidebarName');
      if (sidebarNameEl) sidebarNameEl.textContent = user.fullName || user.email;

      const primaryRole = (typeof roles[0] === 'string' ? roles[0] : roles[0]?.name) || (window.AdminAuth.isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN');
      const sidebarRoleEl = document.getElementById('adminSidebarRole');
      if (sidebarRoleEl) sidebarRoleEl.textContent = primaryRole;

      const dropdownNameEl = document.getElementById('adminDropdownName');
      if (dropdownNameEl) dropdownNameEl.textContent = user.fullName || user.name || 'Super Administrator';

      const dropdownEmailEl = document.getElementById('adminDropdownEmail');
      if (dropdownEmailEl) dropdownEmailEl.textContent = user.email;

      const rolesContainer = document.getElementById('adminDropdownRoles');
      if (rolesContainer) {
        rolesContainer.innerHTML = roles.map(r => {
          const roleName = typeof r === 'string' ? r : (r.name || r.slug || 'ADMIN');
          const isSuper = roleName === 'SUPER_ADMIN' || window.AdminAuth.isSuperAdmin;
          return `<span class="admin-role-badge ${isSuper ? 'super-admin' : ''}">${this._escape(roleName)}</span>`;
        }).join('') || '<span class="admin-role-badge super-admin">SUPER_ADMIN</span>';
      }
    }

    _renderSidebar() {
      const navContainer = document.getElementById('adminSidebarNav');
      if (!navContainer) return;

      let html = '';
      for (const group of NAV_SCHEMA) {
        html += `<div class="admin-nav-group">`;
        html += `<div class="admin-nav-group-label">${this._escape(group.group)}</div>`;

        for (const item of group.items) {
          const hasAccess = item.permission === null || window.AdminAuth.hasPermission(item.permission);
          const iconSvg = ICONS[item.icon] || ICONS.dashboard;

          if (hasAccess) {
            html += `
              <a href="#${item.id}" class="admin-nav-item" data-id="${item.id}">
                ${iconSvg}
                <span>${this._escape(item.label)}</span>
              </a>
            `;
          } else {
            html += `
              <div class="admin-nav-item restricted" title="Requires permission: ${item.permission}">
                ${iconSvg}
                <span>${this._escape(item.label)}</span>
                <span class="admin-nav-lock">${ICONS.lock}</span>
              </div>
            `;
          }
        }
        html += `</div>`;
      }

      navContainer.innerHTML = html;
    }

    _bindEventListeners() {
      window.addEventListener('hashchange', () => this._handleHashRoute());

      const profileBtn = document.getElementById('adminProfileBtn');
      const profileDropdown = document.getElementById('adminProfileDropdown');

      if (profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          profileDropdown.classList.toggle('open');
        });

        document.addEventListener('click', () => {
          profileDropdown.classList.remove('open');
        });
      }

      const logoutBtns = document.querySelectorAll('[data-action="logout"]');
      logoutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          btn.disabled = true;
          // Invariant: Immediately wipe in-memory SQL history & saved queries upon logout
          this.sqlHistoryState.entries = [];
          this.sqlHistoryState.expandedIds.clear();
          this.sqlSavedQueriesState.queries = [];
          this.sqlSavedQueriesState.expandedIds.clear();
          this.toast('Signing out of ZdexCloud Operations...', 'info');
          await window.AdminAuth.logout();
        });
      });

      // Synchronize with AdminAuth changes (logout across tabs, account switching, session refresh)
      if (window.AdminAuth && window.AdminAuth.subscribe) {
        window.AdminAuth.subscribe(({ user }) => {
          if (!user) {
            // Unauthenticated state / logout / session expiration: wipe in-memory history & saved queries
            this.sqlHistoryState.entries = [];
            this.sqlHistoryState.expandedIds.clear();
            this.sqlSavedQueriesState.queries = [];
            this.sqlSavedQueriesState.expandedIds.clear();
          } else {
            const currentAdminId = user.id || user.userId || user.email;
            if (currentAdminId) {
              this._loadSqlHistory();
              this._loadSqlSavedQueries();
              if (this.currentSection === 'sql-runner') {
                this._renderSqlSavedQueriesList();
                this._renderSqlHistoryList();
              }
            }
          }
        });
      }

      const menuToggle = document.getElementById('adminMenuToggle');
      const sidebar = document.getElementById('adminSidebar');
      const backdrop = document.getElementById('adminDrawerBackdrop');

      if (menuToggle && sidebar && backdrop) {
        const toggleDrawer = () => {
          sidebar.classList.toggle('open');
          backdrop.classList.toggle('active');
        };

        menuToggle.addEventListener('click', toggleDrawer);
        backdrop.addEventListener('click', toggleDrawer);
      }

      const resetActivity = () => {
        this.idleSecondsRemaining = 900;
      };
      window.addEventListener('mousemove', resetActivity, { passive: true });
      window.addEventListener('keydown', resetActivity, { passive: true });
      window.addEventListener('click', resetActivity, { passive: true });
    }

    _startIdleCountdown() {
      if (this.idleTimerInterval) clearInterval(this.idleTimerInterval);

      const timerEl = document.getElementById('adminSessionCountdown');

      this.idleTimerInterval = setInterval(() => {
        this.idleSecondsRemaining--;

        if (this.idleSecondsRemaining <= 0) {
          clearInterval(this.idleTimerInterval);
          // Invariant: Immediately purge in-memory history & saved queries on session expiry
          this.sqlHistoryState.entries = [];
          this.sqlHistoryState.expandedIds.clear();
          this.sqlSavedQueriesState.queries = [];
          this.sqlSavedQueriesState.expandedIds.clear();
          this.toast('Admin session expired due to inactivity.', 'danger');
          setTimeout(() => {
            window.AdminAuth.logout();
          }, 1500);
          return;
        }

        if (timerEl) {
          const mins = Math.floor(this.idleSecondsRemaining / 60);
          const secs = this.idleSecondsRemaining % 60;
          timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          
          if (this.idleSecondsRemaining < 120) {
            timerEl.parentElement.classList.add('expiring');
          } else {
            timerEl.parentElement.classList.remove('expiring');
          }
        }
      }, 1000);
    }

    _handleHashRoute() {
      const rawHash = window.location.hash.replace('#', '').trim() || 'dashboard';
      let hash = rawHash;
      if (rawHash === 'customers') hash = 'users';
      if (rawHash === 'audit') hash = 'audit-logs';
      if (rawHash === 'roles') hash = 'admin-roles';
      if (rawHash === 'billing' || rawHash === 'billing-overview' || rawHash === 'financial-overview') hash = 'billing-overview';
      if (rawHash === 'subscriptions' || rawHash === 'billing-subscriptions') hash = 'subscriptions';
      if (rawHash === 'billing-payments') hash = 'payments';
      if (rawHash === 'billing-refunds') hash = 'refunds';
      if (rawHash === 'recon' || rawHash === 'reconciliation' || rawHash === 'billing-reconciliation') hash = 'reconciliation';
      if (rawHash === 'settlements' || rawHash === 'billing-settlements') hash = 'settlements';
      if (rawHash === 'errors' || rawHash === 'error-center' || rawHash === 'observability' || rawHash === 'observability-center') hash = 'observability-center';
      if (rawHash === 'emails' || rawHash === 'email' || rawHash === 'email-operations' || rawHash === 'email-analytics' || rawHash === 'email-tracking') hash = 'email-operations';
      if (rawHash === 'sql' || rawHash === 'sql-query' || rawHash === 'sql-runner' || rawHash === 'sql-query-runner') hash = 'sql-runner';
      if (rawHash === 'database' || rawHash === 'database-mgmt' || rawHash === 'database-management' || rawHash === 'db') hash = 'database';
      this.currentSection = hash;

      const navItems = document.querySelectorAll('.admin-nav-item[data-id]');
      navItems.forEach(el => {
        const itemId = el.getAttribute('data-id');
        if (
          itemId === hash ||
          (rawHash === 'customers' && itemId === 'users') ||
          (rawHash === 'audit' && itemId === 'audit-logs') ||
          (rawHash === 'roles' && itemId === 'admin-roles') ||
          ((rawHash === 'billing' || rawHash === 'billing-overview' || rawHash === 'financial-overview') && itemId === 'billing-overview') ||
          ((rawHash === 'subscriptions' || rawHash === 'billing-subscriptions') && itemId === 'subscriptions') ||
          (rawHash === 'billing-payments' && itemId === 'payments') ||
          (rawHash === 'billing-refunds' && itemId === 'refunds') ||
          ((rawHash === 'recon' || rawHash === 'reconciliation' || rawHash === 'billing-reconciliation') && itemId === 'reconciliation') ||
          ((rawHash === 'settlements' || rawHash === 'billing-settlements') && itemId === 'settlements') ||
          ((rawHash === 'errors' || rawHash === 'error-center' || rawHash === 'observability' || rawHash === 'observability-center') && itemId === 'observability-center') ||
          ((rawHash === 'emails' || rawHash === 'email' || rawHash === 'email-operations' || rawHash === 'email-analytics' || rawHash === 'email-tracking') && itemId === 'email-operations') ||
          ((rawHash === 'sql' || rawHash === 'sql-query' || rawHash === 'sql-runner' || rawHash === 'sql-query-runner') && itemId === 'sql-runner') ||
          ((rawHash === 'database' || rawHash === 'database-mgmt' || rawHash === 'database-management' || rawHash === 'db') && itemId === 'database')
        ) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });

      let currentItem = null;
      let currentGroup = null;

      for (const group of NAV_SCHEMA) {
        for (const item of group.items) {
          if (item.id === hash || item.id === rawHash) {
            currentItem = item;
            currentGroup = group;
            break;
          }
        }
        if (currentItem) break;
      }

      const breadcrumbGroup = document.getElementById('adminBreadcrumbGroup');
      const breadcrumbItem = document.getElementById('adminBreadcrumbCurrent');
      if (breadcrumbGroup && breadcrumbItem) {
        breadcrumbGroup.textContent = currentGroup ? currentGroup.group : 'Overview';
        breadcrumbItem.textContent = currentItem
          ? currentItem.label
          : (hash === 'users' ? 'Customer Accounts' : (hash === 'billing-overview' ? 'Financial & Billing Overview' : (hash === 'subscriptions' ? 'Subscriptions & Dunning' : (hash === 'payments' ? 'Payments & Transactions' : (hash === 'refunds' ? 'Refunds & Returns' : (hash === 'reconciliation' ? 'Billing Reconciliation & Drift' : (hash === 'settlements' ? 'Settlements & Payouts' : (hash === 'observability-center' ? 'Error & Incident Center' : (hash === 'email-operations' ? 'Email Operations' : (hash === 'database' ? 'Database Management' : 'Dashboard'))))))))));
      }

      if (currentItem && currentItem.permission && !window.AdminAuth.hasPermission(currentItem.permission)) {
        this._renderForbiddenView(currentItem);
        return;
      }

      this._renderView(hash);
    }

    _renderView(sectionId) {
      const container = document.getElementById('adminViewContainer');
      if (!container) return;

      switch (sectionId) {
        case 'dashboard':
          this._renderDashboardView(container);
          break;
        case 'customers':
        case 'users':
          this._renderUsersView(container);
          break;
        case 'devices':
          this._renderDevicesView(container);
          break;
        case 'servers':
          this._renderServersView(container);
          break;
        case 'gateway':
          this._renderGatewayView(container);
          break;
        case 'billing':
        case 'billing-overview':
        case 'financial-overview':
          this._renderBillingOverviewView(container);
          break;
        case 'subscriptions':
        case 'billing-subscriptions':
          this._renderSubscriptionsView(container);
          break;
        case 'payments':
        case 'billing-payments':
          this._renderPaymentsView(container);
          break;
        case 'refunds':
        case 'billing-refunds':
          this._renderRefundsView(container);
          break;
        case 'reconciliation':
        case 'recon':
        case 'billing-reconciliation':
          this._renderReconciliationView(container);
          break;
        case 'settlements':
        case 'billing-settlements':
          this._renderSettlementsView(container);
          break;
        case 'support':
        case 'support-cases':
        case 'support-desk':
          this._renderSupportView(container);
          break;
        case 'admin-roles':
        case 'roles':
          this._renderRolesView(container);
          break;
        case 'audit-logs':
        case 'audit':
          this._renderAuditLogsView(container);
          break;
        case 'observability-center':
        case 'errors':
        case 'error-center':
        case 'observability':
          this._renderErrorCenterView(container);
          break;
        case 'email-operations':
        case 'emails':
        case 'email':
        case 'email-analytics':
        case 'email-tracking':
          this._renderEmailOperationsView(container);
          break;
        case 'database':
        case 'database-mgmt':
        case 'database-management':
        case 'db':
          this._renderDatabaseManagementView(container);
          break;
        case 'sql-runner':
        case 'sql':
        case 'sql-query':
        case 'sql-query-runner':
          this._renderSqlRunnerView(container);
          break;
        default:
          this._renderDashboardView(container);
      }
    }

    /* =========================================================================
       1. OVERVIEW DASHBOARD VIEW
       ========================================================================= */
    async _renderDashboardView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Operations Overview</h1>
            <p>Authoritative infrastructure state, edge node status, and administrative control telemetry.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._renderDashboardView(document.getElementById('adminViewContainer'))">
              ${ICONS['refresh-cw']} Refresh Telemetry
            </button>
          </div>
        </div>

        <div id="adminDashCards" class="admin-grid-4">
          <div class="admin-card"><div class="admin-stat-label">Customer Accounts</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Edge Devices</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Server Instances</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Gateway Nodes</div><div class="admin-stat-value">...</div></div>
        </div>

        <div class="admin-grid-2" style="margin-top:var(--space-xl);">
          <!-- Operational Telemetry & Infrastructure Health -->
          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h3 style="font-size:1.05rem;font-weight:700;margin:0;">Infrastructure Health &amp; Relays</h3>
              <span class="admin-badge admin-badge-success">LIVE TELEMETRY</span>
            </div>
            <div id="adminDashBreakdown" style="display:flex;flex-direction:column;gap:0.75rem;">
              <p style="color:var(--admin-text-muted);font-size:0.875rem;">Loading telemetry metrics...</p>
            </div>
          </div>

          <!-- Active Control Planes Quick Access Hub -->
          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h3 style="font-size:1.05rem;font-weight:700;margin:0;">Operational Control Planes</h3>
              <span class="admin-badge admin-badge-info">AUTHENTICATED</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <a href="#users" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS.users} <span>Customer Accounts</span>
                </a>
                <a href="#devices" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS.server} <span>Devices &amp; Nodes</span>
                </a>
                <a href="#servers" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS['hard-drive']} <span>Server Instances</span>
                </a>
                <a href="#gateway" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS.radio} <span>Gateway &amp; Relays</span>
                </a>
              </div>

              <div style="border-top:1px solid var(--admin-border-subtle);margin:0.25rem 0;"></div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <a href="#billing-overview" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS.dashboard} <span>Financial Overview</span>
                </a>
                <a href="#subscriptions" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS['credit-card']} <span>Subscriptions</span>
                </a>
                <a href="#payments" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS['dollar-sign']} <span>Payments Ledger</span>
                </a>
                <a href="#reconciliation" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS['git-compare']} <span>Reconciliation</span>
                </a>
              </div>

              <div style="border-top:1px solid var(--admin-border-subtle);margin:0.25rem 0;"></div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <a href="#admin-roles" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS.shield} <span>Roles &amp; RBAC</span>
                </a>
                <a href="#audit-logs" class="admin-btn admin-btn-secondary admin-btn-sm" style="justify-content:flex-start;gap:0.5rem;">
                  ${ICONS['file-text']} <span>Security Audit Logs</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Authoritative Control Plane Module Registry Matrix -->
        <div class="admin-card" style="margin-top:var(--space-xl);">
          <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md);">
            <div>
              <h2 class="admin-card-title" style="margin:0;font-size:1.125rem;font-weight:700;">ZdexCloud Control Plane — Authoritative Module Registry</h2>
              <p style="margin:0.25rem 0 0 0;font-size:0.8125rem;color:var(--admin-text-muted);">
                Real-time operational status and security classification across all implemented and scheduled platform modules.
              </p>
            </div>
            <span class="admin-badge admin-badge-neutral">Registry v2.4</span>
          </div>

          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Module Name &amp; Description</th>
                  <th>Category</th>
                  <th>Authoritative Phase</th>
                  <th>Required Authority</th>
                  <th>Implementation State</th>
                  <th style="text-align:right;">Control Plane Access</th>
                </tr>
              </thead>
              <tbody>
                ${MODULE_REGISTRY.map(m => {
                  const isImplemented = m.status === 'IMPLEMENTED';
                  const hasPerm = m.permission === null || window.AdminAuth.hasPermission(m.permission);
                  const iconSvg = ICONS[m.icon] || ICONS.dashboard;

                  let statusBadge = `<span class="admin-badge admin-badge-success">${ICONS.check} OPERATIONAL</span>`;
                  if (!isImplemented) {
                    statusBadge = `<span class="admin-badge admin-badge-neutral">${this._escape(m.phase)} SCHEDULED</span>`;
                  }

                  let actionCell = '';
                  if (isImplemented) {
                    if (hasPerm) {
                      actionCell = `
                        <a href="${this._escape(m.route)}" class="admin-btn admin-btn-secondary admin-btn-xs" style="display:inline-flex;align-items:center;gap:4px;">
                          Open Module &rarr;
                        </a>
                      `;
                    } else {
                      actionCell = `
                        <span class="admin-badge admin-badge-warning" title="Requires ${m.permission}">
                          ${ICONS.lock} RESTRICTED
                        </span>
                      `;
                    }
                  } else {
                    actionCell = `<span style="font-size:0.75rem;color:var(--admin-text-subtle);font-family:var(--font-mono);">Future Phase</span>`;
                  }

                  return `
                    <tr>
                      <td>
                        <div style="display:flex;align-items:center;gap:0.625rem;">
                          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--radius-xs);background:var(--admin-bg-subtle);">
                            ${iconSvg}
                          </span>
                          <div>
                            <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(m.name)}</strong>
                            <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:1px;">${this._escape(m.description)}</div>
                          </div>
                        </div>
                      </td>
                      <td style="font-size:0.8125rem;">${this._escape(m.category)}</td>
                      <td style="font-size:0.8125rem;"><strong>${this._escape(m.phase)}</strong></td>
                      <td>
                        <code class="admin-code-pill" style="font-size:0.6875rem;">${this._escape(m.permission || 'Authenticated')}</code>
                      </td>
                      <td>${statusBadge}</td>
                      <td style="text-align:right;">${actionCell}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      try {
        const [usersRes, devicesRes, serversRes, telemetryRes] = await Promise.all([
          window.AdminApi.get('/admin/operations/users?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/devices?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/servers?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/gateway/telemetry').catch(() => ({ data: { telemetry: {} } }))
        ]);

        const usersTotal = usersRes?.data?.total || 0;
        const devicesTotal = devicesRes?.data?.total || 0;
        const serversTotal = serversRes?.data?.total || 0;
        const telemetry = telemetryRes?.data?.telemetry || {};

        const cardsContainer = document.getElementById('adminDashCards');
        if (cardsContainer) {
          cardsContainer.innerHTML = `
            <div class="admin-card">
              <div class="admin-stat-label"><span>Customer Accounts</span><span class="admin-status-dot" style="background-color:var(--admin-success)"></span></div>
              <div class="admin-stat-value">${usersTotal}</div>
              <div class="admin-stat-subtext"><a href="#users" style="color:var(--admin-primary);font-weight:600;">Inspect Directory &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Edge Devices &amp; Nodes</span><span class="admin-status-dot" style="background-color:var(--admin-primary)"></span></div>
              <div class="admin-stat-value">${devicesTotal}</div>
              <div class="admin-stat-subtext"><a href="#devices" style="color:var(--admin-primary);font-weight:600;">Inspect Devices &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Server Instances</span><span class="admin-status-dot" style="background-color:var(--admin-warning)"></span></div>
              <div class="admin-stat-value">${serversTotal}</div>
              <div class="admin-stat-subtext"><a href="#servers" style="color:var(--admin-primary);font-weight:600;">Power Controls &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Gateway Relay Nodes</span><span class="admin-status-dot" style="background-color:var(--admin-success)"></span></div>
              <div class="admin-stat-value">${telemetry.totalGatewayNodes || 0}</div>
              <div class="admin-stat-subtext">Active Tunnels: <strong>${telemetry.totalActiveConnections || 0}</strong></div>
            </div>
          `;
        }

        const breakdownContainer = document.getElementById('adminDashBreakdown');
        if (breakdownContainer) {
          breakdownContainer.innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);font-size:0.875rem;">Active Gateway Nodes:</span>
              <span class="admin-badge admin-badge-success">${telemetry.activeGatewayNodes || 0} ACTIVE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);font-size:0.875rem;">Maintenance Gateway Nodes:</span>
              <span class="admin-badge admin-badge-warning">${telemetry.maintenanceGatewayNodes || 0} MAINTENANCE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);font-size:0.875rem;">Connected Online Devices:</span>
              <span class="admin-badge admin-badge-info">${telemetry.connectedDevices || 0} ONLINE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);font-size:0.875rem;">Active File Relay Streams:</span>
              <strong>${telemetry.runtimeTelemetry?.activeTransfers || 0}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;">
              <span style="color:var(--admin-text-secondary);font-size:0.875rem;">Security Integrity State:</span>
              <span class="admin-badge admin-badge-success">${ICONS.check} SHA-256 CHAINED</span>
            </div>
          `;
        }
      } catch (err) {
        console.warn('Dashboard metrics fetch notice:', err);
      }
    }

    /* =========================================================================
       2. USERS MANAGEMENT VIEW
       ========================================================================= */
    async _renderUsersView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Customer Accounts</h1>
            <p>Manage customer identities, verification status, and administrative account suspensions.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadUsers()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="userSearchInput" class="admin-search-input" placeholder="Search by email or name..." value="${this._escape(this.userState.search)}">
            </div>
            <select id="userStatusSelect" class="admin-select">
              <option value="" ${this.userState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="ACTIVE" ${this.userState.status === 'ACTIVE' ? 'selected' : ''}>Active</option>
              <option value="SUSPENDED" ${this.userState.status === 'SUSPENDED' ? 'selected' : ''}>Suspended</option>
              <option value="PENDING_VERIFICATION" ${this.userState.status === 'PENDING_VERIFICATION' ? 'selected' : ''}>Pending Verification</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>User / Email</th>
                  <th>Full Name</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Devices</th>
                  <th>Sessions</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="userTableBody">
                <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading customer directory...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="userPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('userSearchInput');
      const statusSelect = document.getElementById('userStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.userState.search = e.target.value.trim();
          this.userState.page = 1;
          this.loadUsers();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.userState.status = e.target.value;
        this.userState.page = 1;
        this.loadUsers();
      });

      this.loadUsers();
    }

    async loadUsers() {
      const tbody = document.getElementById('userTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading users...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.userState.page.toString(),
          pageSize: this.userState.pageSize.toString()
        });
        if (this.userState.search) queryParams.set('search', this.userState.search);
        if (this.userState.status) queryParams.set('status', this.userState.status);

        const res = await window.AdminApi.get(`/admin/operations/users?${queryParams.toString()}`);
        const data = res.data;
        this.userState.items = data.items || [];
        this.userState.total = data.total || 0;

        if (this.userState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS.users}
                  <div class="admin-empty-title">No customer accounts found</div>
                  <div class="admin-empty-desc">No accounts match your current filter parameters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('userPaginationBar', this.userState, (p) => { this.userState.page = p; this.loadUsers(); });
          return;
        }

        const canSuspend = window.AdminAuth.hasPermission('users.suspend');

        tbody.innerHTML = this.userState.items.map(u => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(u.email)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(u.id)}</div>
            </td>
            <td>${this._escape(u.fullName || '—')}</td>
            <td>${this._renderStatusBadge(u.status)}</td>
            <td>${u.emailVerified ? '<span class="admin-badge admin-badge-success">Verified</span>' : '<span class="admin-badge admin-badge-neutral">Unverified</span>'}</td>
            <td><strong>${u.deviceCount}</strong></td>
            <td>${u.activeSessionCount}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${new Date(u.createdAt).toLocaleDateString()}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectUser('${u.id}')" title="Inspect user profile">
                  ${ICONS.eye} Inspect
                </button>
                ${canSuspend && u.status === 'ACTIVE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmSuspendUser('${u.id}', '${this._escape(u.email)}')" title="Suspend account">
                    Suspend
                  </button>
                ` : ''}
                ${canSuspend && u.status === 'SUSPENDED' ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.confirmRestoreUser('${u.id}', '${this._escape(u.email)}')" title="Restore account">
                    Restore
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('userPaginationBar', this.userState, (p) => { this.userState.page = p; this.loadUsers(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load users')}</td></tr>`;
      }
    }

    async inspectUser(userId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/users/${userId}`);
        const user = res.data.user;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Identity & Account</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">User ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(user.id)}</code></span>
              <span class="admin-property-label">Email Address:</span>
              <span class="admin-property-value"><strong>${this._escape(user.email)}</strong></span>
              <span class="admin-property-label">Full Name:</span>
              <span class="admin-property-value">${this._escape(user.fullName || '—')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(user.status)}</span>
              <span class="admin-property-label">Email Verified:</span>
              <span class="admin-property-value">${user.emailVerified ? 'Yes' : 'No'}</span>
              <span class="admin-property-label">Created At:</span>
              <span class="admin-property-value">${new Date(user.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Linked Edge Devices (${user.devices ? user.devices.length : 0})</div>
            ${user.devices && user.devices.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${user.devices.map(d => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(d.deviceName)}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(d.platform)} &bull; ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                      ${this._renderStatusBadge(d.status)}
                      <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectDevice('${d.id}')" title="Inspect device details">
                        ${ICONS.eye}
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No hardware devices paired to this account.</p>'}
          </div>

          ${user.billing ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Commercial &amp; Billing State</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Billing Status:</span>
                <span class="admin-property-value">${this._renderStatusBadge(user.billing.status || 'ACTIVE')}</span>
                <span class="admin-property-label">Currency:</span>
                <span class="admin-property-value"><strong>${this._escape(user.billing.currency || 'INR')}</strong></span>
                <span class="admin-property-label">Country:</span>
                <span class="admin-property-value">${this._escape(user.billing.billingCountry || 'IN')}</span>
              </div>
              <div style="margin-top:0.75rem;display:flex;gap:0.5rem;">
                <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.showGlobalBillingSearchModal('${this._escape(user.email)}')">
                  ${ICONS.search} Search Commercial Ledger
                </button>
              </div>
            </div>
          ` : ''}

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${window.AdminAuth.hasPermission('users.suspend') && user.status === 'ACTIVE' ? `
              <button class="admin-btn admin-btn-danger" onclick="AdminShell.confirmSuspendUser('${user.id}', '${this._escape(user.email)}')">
                Suspend Account
              </button>
            ` : ''}
            ${window.AdminAuth.hasPermission('users.suspend') && user.status === 'SUSPENDED' ? `
              <button class="admin-btn admin-btn-primary" onclick="AdminShell.confirmRestoreUser('${user.id}', '${this._escape(user.email)}')">
                Restore Account
              </button>
            ` : ''}
          </div>
        `;

        this._showDrawer(`Customer: ${user.email}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect customer', 'danger');
      }
    }

    confirmSuspendUser(userId, email) {
      this.showConfirmModal({
        title: 'Suspend Customer Account',
        message: `Are you sure you want to suspend account <strong>${this._escape(email)}</strong>? This will revoke all active login sessions and restrict node access.`,
        warningText: 'Administrative suspension takes immediate effect.',
        confirmLabel: 'Suspend Account',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/users/${userId}/suspend`, { reason });
          this.toast(`User '${email}' suspended successfully.`, 'success');
          this.loadUsers();
        }
      });
    }

    confirmRestoreUser(userId, email) {
      this.showConfirmModal({
        title: 'Restore Customer Account',
        message: `Restore customer account <strong>${this._escape(email)}</strong> back to active status?`,
        confirmLabel: 'Restore Account',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/users/${userId}/restore`, { reason });
          this.toast(`User '${email}' restored successfully.`, 'success');
          this.loadUsers();
        }
      });
    }

    /* =========================================================================
       3. DEVICES MANAGEMENT VIEW
       ========================================================================= */
    async _renderDevicesView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Devices & Edge Nodes</h1>
            <p>Inspect connected edge hardware, platform metadata, and perform administrative session evictions.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadDevices()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="deviceSearchInput" class="admin-search-input" placeholder="Search by name, OS, or user..." value="${this._escape(this.deviceState.search)}">
            </div>
            <select id="deviceStatusSelect" class="admin-select">
              <option value="" ${this.deviceState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="ONLINE" ${this.deviceState.status === 'ONLINE' ? 'selected' : ''}>Online</option>
              <option value="OFFLINE" ${this.deviceState.status === 'OFFLINE' ? 'selected' : ''}>Offline</option>
              <option value="CONNECTING" ${this.deviceState.status === 'CONNECTING' ? 'selected' : ''}>Connecting</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Device Name</th>
                  <th>Owner</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Servers</th>
                  <th>Last Seen</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="deviceTableBody">
                <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading devices...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="devicePaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('deviceSearchInput');
      const statusSelect = document.getElementById('deviceStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.deviceState.search = e.target.value.trim();
          this.deviceState.page = 1;
          this.loadDevices();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.deviceState.status = e.target.value;
        this.deviceState.page = 1;
        this.loadDevices();
      });

      this.loadDevices();
    }

    async loadDevices() {
      const tbody = document.getElementById('deviceTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading devices...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.deviceState.page.toString(),
          pageSize: this.deviceState.pageSize.toString()
        });
        if (this.deviceState.search) queryParams.set('search', this.deviceState.search);
        if (this.deviceState.status) queryParams.set('status', this.deviceState.status);

        const res = await window.AdminApi.get(`/admin/operations/devices?${queryParams.toString()}`);
        const data = res.data;
        this.deviceState.items = data.items || [];
        this.deviceState.total = data.total || 0;

        if (this.deviceState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS.server}
                  <div class="admin-empty-title">No devices found</div>
                  <div class="admin-empty-desc">No hardware devices match your current filters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('devicePaginationBar', this.deviceState, (p) => { this.deviceState.page = p; this.loadDevices(); });
          return;
        }

        const canDisconnect = window.AdminAuth.hasPermission('devices.disconnect');

        tbody.innerHTML = this.deviceState.items.map(d => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(d.deviceName)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(d.id)}</div>
            </td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(d.userEmail)}</span></td>
            <td>${this._escape(d.platform)} ${d.osVersion ? `<span style="font-size:0.75rem;color:var(--admin-text-muted);">(v${this._escape(d.osVersion)})</span>` : ''}</td>
            <td>${this._renderStatusBadge(d.status)}</td>
            <td><strong>${d.serverCount}</strong></td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${new Date(d.createdAt).toLocaleDateString()}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectDevice('${d.id}')" title="Inspect device">
                  ${ICONS.eye} Inspect
                </button>
                ${canDisconnect && d.status !== 'OFFLINE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmDisconnectDevice('${d.id}', '${this._escape(d.deviceName)}')" title="Disconnect session">
                    Disconnect
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('devicePaginationBar', this.deviceState, (p) => { this.deviceState.page = p; this.loadDevices(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load devices')}</td></tr>`;
      }
    }

    async inspectDevice(deviceId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/devices/${deviceId}`);
        const dev = res.data.device;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Device Identity</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Device ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(dev.id)}</code></span>
              <span class="admin-property-label">Device Name:</span>
              <span class="admin-property-value"><strong>${this._escape(dev.deviceName)}</strong></span>
              <span class="admin-property-label">Owner Email:</span>
              <span class="admin-property-value">${this._escape(dev.user?.email || 'Unknown')}</span>
              <span class="admin-property-label">Platform / OS:</span>
              <span class="admin-property-value">${this._escape(dev.platform)} ${dev.osVersion ? `(${this._escape(dev.osVersion)})` : ''}</span>
              <span class="admin-property-label">App Version:</span>
              <span class="admin-property-value">${this._escape(dev.appVersion || '—')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(dev.status)}</span>
              <span class="admin-property-label">Last Seen:</span>
              <span class="admin-property-value">${dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString() : 'Never'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Active Gateway Connection</div>
            ${dev.activeConnection ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Tunnel Status:</span>
                <span class="admin-property-value">${this._renderStatusBadge(dev.activeConnection.status)}</span>
                <span class="admin-property-label">Remote Endpoint:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(dev.activeConnection.remoteEndpoint || '—')}</code></span>
                <span class="admin-property-label">Connected At:</span>
                <span class="admin-property-value">${dev.activeConnection.connectedAt ? new Date(dev.activeConnection.connectedAt).toLocaleString() : '—'}</span>
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No active gateway tunnel connection.</p>'}
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Linked Server Instances (${dev.servers.length})</div>
            ${dev.servers.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${dev.servers.map(s => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(s.serverName || 'Default Server')}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">${s.endpoints.map(e => e.hostname).join(', ') || 'No endpoint'}</div>
                    </div>
                    ${this._renderStatusBadge(s.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No server instances running on this device.</p>'}
          </div>
        `;

        this._showDrawer(`Device: ${dev.deviceName}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect device', 'danger');
      }
    }

    confirmDisconnectDevice(deviceId, deviceName) {
      this.showConfirmModal({
        title: 'Disconnect Edge Device Session',
        message: `Forcibly disconnect device <strong>${this._escape(deviceName)}</strong>? This will terminate its active WebSocket connection on the gateway cluster.`,
        warningText: 'The device will need to reconnect to resume server relay operations.',
        confirmLabel: 'Disconnect Device',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/devices/${deviceId}/disconnect`, { reason });
          this.toast(`Device '${deviceName}' disconnected successfully.`, 'success');
          this.loadDevices();
        }
      });
    }

    /* =========================================================================
       4. SERVERS MANAGEMENT VIEW
       ========================================================================= */
    async _renderServersView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Server Instances</h1>
            <p>Control customer edge file servers, DNS endpoint routing, and power states.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadServers()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="serverSearchInput" class="admin-search-input" placeholder="Search by name, host, or user..." value="${this._escape(this.serverState.search)}">
            </div>
            <select id="serverStatusSelect" class="admin-select">
              <option value="" ${this.serverState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="RUNNING" ${this.serverState.status === 'RUNNING' ? 'selected' : ''}>Running</option>
              <option value="STARTING" ${this.serverState.status === 'STARTING' ? 'selected' : ''}>Starting</option>
              <option value="STOPPED" ${this.serverState.status === 'STOPPED' ? 'selected' : ''}>Stopped</option>
              <option value="ERROR" ${this.serverState.status === 'ERROR' ? 'selected' : ''}>Error</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Owner</th>
                  <th>Device Node</th>
                  <th>Status</th>
                  <th>Endpoint Hostname</th>
                  <th>Started At</th>
                  <th style="text-align:right;">Power Actions</th>
                </tr>
              </thead>
              <tbody id="serverTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading servers...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="serverPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('serverSearchInput');
      const statusSelect = document.getElementById('serverStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.serverState.search = e.target.value.trim();
          this.serverState.page = 1;
          this.loadServers();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.serverState.status = e.target.value;
        this.serverState.page = 1;
        this.loadServers();
      });

      this.loadServers();
    }

    async loadServers() {
      const tbody = document.getElementById('serverTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading servers...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.serverState.page.toString(),
          pageSize: this.serverState.pageSize.toString()
        });
        if (this.serverState.search) queryParams.set('search', this.serverState.search);
        if (this.serverState.status) queryParams.set('status', this.serverState.status);

        const res = await window.AdminApi.get(`/admin/operations/servers?${queryParams.toString()}`);
        const data = res.data;
        this.serverState.items = data.items || [];
        this.serverState.total = data.total || 0;

        if (this.serverState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['hard-drive']}
                  <div class="admin-empty-title">No servers found</div>
                  <div class="admin-empty-desc">No server instances match your current filters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('serverPaginationBar', this.serverState, (p) => { this.serverState.page = p; this.loadServers(); });
          return;
        }

        const canPower = window.AdminAuth.hasPermission('servers.power');

        tbody.innerHTML = this.serverState.items.map(s => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(s.serverName || 'Storage Server')}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(s.id)}</div>
            </td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(s.userEmail)}</span></td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(s.deviceName)}</span></td>
            <td>${this._renderStatusBadge(s.status)}</td>
            <td><code class="admin-code-pill">${s.endpoints.map(e => this._escape(e.hostname)).join(', ') || 'No DNS record'}</code></td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${s.startedAt ? new Date(s.startedAt).toLocaleString() : 'Stopped'}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectServer('${s.id}')" title="Inspect server">
                  ${ICONS.eye} Inspect
                </button>
                ${canPower && (s.status === 'STOPPED' || s.status === 'ERROR') ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.executeStartServer('${s.id}')" title="Start server">
                    ${ICONS.play} Start
                  </button>
                ` : ''}
                ${canPower && (s.status === 'RUNNING' || s.status === 'STARTING') ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmStopServer('${s.id}', '${this._escape(s.serverName || s.id)}')" title="Stop server">
                    ${ICONS.square} Stop
                  </button>
                ` : ''}
                ${canPower && s.status === 'RUNNING' ? `
                  <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.confirmRestartServer('${s.id}', '${this._escape(s.serverName || s.id)}')" title="Restart server">
                    ${ICONS.rotate} Restart
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('serverPaginationBar', this.serverState, (p) => { this.serverState.page = p; this.loadServers(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load servers')}</td></tr>`;
      }
    }

    async inspectServer(serverId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/servers/${serverId}`);
        const srv = res.data.server;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Server Instance Information</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Server ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(srv.id)}</code></span>
              <span class="admin-property-label">Server Name:</span>
              <span class="admin-property-value"><strong>${this._escape(srv.serverName || 'Default Server')}</strong></span>
              <span class="admin-property-label">Admin Username:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(srv.adminUsername || 'admin')}</code></span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(srv.status)}</span>
              <span class="admin-property-label">Started At:</span>
              <span class="admin-property-value">${srv.startedAt ? new Date(srv.startedAt).toLocaleString() : 'Stopped'}</span>
              <span class="admin-property-label">Last Heartbeat:</span>
              <span class="admin-property-value">${srv.lastHeartbeatAt ? new Date(srv.lastHeartbeatAt).toLocaleString() : 'None'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Host Device & Owner</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Device Name:</span>
              <span class="admin-property-value">${this._escape(srv.device?.deviceName || 'Unknown Device')}</span>
              <span class="admin-property-label">Owner Email:</span>
              <span class="admin-property-value">${this._escape(srv.user?.email || 'Unknown')}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Assigned Remote Endpoints (${srv.endpoints.length})</div>
            ${srv.endpoints.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${srv.endpoints.map(e => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <code class="admin-code-pill" style="font-size:0.875rem;">${this._escape(e.hostname)}</code>
                    ${this._renderStatusBadge(e.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No DNS endpoints assigned.</p>'}
          </div>
        `;

        this._showDrawer(`Server: ${srv.serverName || srv.id}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect server', 'danger');
      }
    }

    async executeStartServer(serverId) {
      try {
        this.toast('Initiating server start...', 'info');
        await window.AdminApi.post(`/admin/operations/servers/${serverId}/start`, {});
        this.toast('Server start initiated successfully.', 'success');
        this.loadServers();
      } catch (err) {
        this.toast(err.message || 'Failed to start server', 'danger');
      }
    }

    confirmStopServer(serverId, serverName) {
      this.showConfirmModal({
        title: 'Stop Server Instance',
        message: `Are you sure you want to stop server <strong>${this._escape(serverName)}</strong>? This will terminate active gateway relay sessions.`,
        warningText: 'Customer file access will be unavailable until restarted.',
        confirmLabel: 'Stop Server',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/servers/${serverId}/stop`, { reason });
          this.toast(`Server '${serverName}' stopped successfully.`, 'success');
          this.loadServers();
        }
      });
    }

    confirmRestartServer(serverId, serverName) {
      this.showConfirmModal({
        title: 'Restart Server Instance',
        message: `Restart server instance <strong>${this._escape(serverName)}</strong>?`,
        confirmLabel: 'Restart Server',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/servers/${serverId}/restart`, { reason });
          this.toast(`Server '${serverName}' restart initiated.`, 'success');
          this.loadServers();
        }
      });
    }

    /* =========================================================================
       5. GATEWAY OPERATIONS & TELEMETRY VIEW
       ========================================================================= */
    async _renderGatewayView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Gateway & Relays</h1>
            <p>Monitor distributed WebSocket routing nodes, drain maintenance clusters, and inspect tunnel connections.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.refreshGatewaySubTab()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-tabs-nav">
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'nodes' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('nodes')">
            ${ICONS.server} Gateway Nodes
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'telemetry' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('telemetry')">
            ${ICONS.dashboard} Live Telemetry
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'diagnostics' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('diagnostics')">
            ${ICONS.shield} Diagnostics
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'connections' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('connections')">
            ${ICONS.radio} Active Connections
          </button>
        </div>

        <div id="gatewayTabContent"></div>
      `;

      this.renderGatewayTabContent();
    }

    switchGatewayTab(tabKey) {
      this.gatewayActiveTab = tabKey;
      const tabBtns = document.querySelectorAll('.admin-tab-btn');
      tabBtns.forEach(btn => {
        if (btn.textContent.toLowerCase().includes(tabKey)) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      this.renderGatewayTabContent();
    }

    refreshGatewaySubTab() {
      this.renderGatewayTabContent();
    }

    async renderGatewayTabContent() {
      const container = document.getElementById('gatewayTabContent');
      if (!container) return;

      if (this.gatewayActiveTab === 'nodes') {
        container.innerHTML = `
          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Gateway Hostname</th>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Active Tunnels</th>
                    <th>Total Tunnels</th>
                    <th>Last Heartbeat</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="gatewayNodeTableBody">
                  <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading gateway nodes...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="gatewayNodePaginationBar" class="admin-pagination-bar"></div>
          </div>
        `;
        this.loadGatewayNodes();
      } else if (this.gatewayActiveTab === 'telemetry') {
        container.innerHTML = `<p style="color:var(--admin-text-muted);">Loading telemetry...</p>`;
        try {
          const res = await window.AdminApi.get('/admin/operations/gateway/telemetry');
          const t = res.data.telemetry;

          container.innerHTML = `
            <div class="admin-grid-4">
              <div class="admin-card">
                <div class="admin-stat-label"><span>Active Nodes</span><span class="admin-status-dot" style="background:var(--admin-success);"></span></div>
                <div class="admin-stat-value">${t.activeGatewayNodes || 0} / ${t.totalGatewayNodes || 0}</div>
                <div class="admin-stat-subtext">Maintenance: ${t.maintenanceGatewayNodes || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Active Tunnels</span><span class="admin-status-dot" style="background:var(--admin-primary);"></span></div>
                <div class="admin-stat-value">${t.totalActiveConnections || 0}</div>
                <div class="admin-stat-subtext">Historical: ${t.totalHistoricalConnections || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Connected Devices</span><span class="admin-status-dot" style="background:var(--admin-info);"></span></div>
                <div class="admin-stat-value">${t.connectedDevices || 0}</div>
                <div class="admin-stat-subtext">Active Sockets: ${t.runtimeTelemetry?.activeConnections || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Gateway Uptime</span><span class="admin-status-dot" style="background:var(--admin-success);"></span></div>
                <div class="admin-stat-value" style="font-size:1.35rem;">${Math.floor((t.runtimeTelemetry?.uptimeSeconds || 0) / 60)} mins</div>
                <div class="admin-stat-subtext">Status: <strong>${t.runtimeTelemetry?.gatewayStatus || 'ACTIVE'}</strong></div>
              </div>
            </div>

            <div class="admin-card" style="margin-top:var(--space-xl);">
              <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Runtime Traffic & Rate Limiting</h3>
              <div class="admin-property-grid">
                <span class="admin-property-label">Reconnect Events:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.reconnectCount || 0}</strong></span>
                <span class="admin-property-label">Rate Limit Events:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.rateLimitEvents || 0}</strong></span>
                <span class="admin-property-label">Timed-Out Requests:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.timedOutRequests || 0}</strong></span>
                <span class="admin-property-label">Failed Auth Attempts:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.failedAuthCount || 0}</strong></span>
                <span class="admin-property-label">Active Transfers:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.activeTransfers || 0}</strong></span>
              </div>
            </div>
          `;
        } catch (err) {
          container.innerHTML = `<p style="color:var(--admin-danger);">${this._escape(err.message || 'Failed to load telemetry')}</p>`;
        }
      } else if (this.gatewayActiveTab === 'diagnostics') {
        container.innerHTML = `<p style="color:var(--admin-text-muted);">Loading diagnostics...</p>`;
        try {
          const res = await window.AdminApi.get('/admin/operations/gateway/diagnostics');
          const d = res.data.diagnostics;

          container.innerHTML = `
            <div class="admin-grid-2">
              <div class="admin-card">
                <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Gateway Subsystem Health</h3>
                <div class="admin-property-grid">
                  <span class="admin-property-label">Process Status:</span>
                  <span class="admin-property-value"><span class="admin-badge admin-badge-success">${this._escape(d.gatewayProcessStatus)}</span></span>
                  <span class="admin-property-label">Control Plane:</span>
                  <span class="admin-property-value">${d.controlPlaneConnected ? '<span class="admin-badge admin-badge-success">Connected</span>' : '<span class="admin-badge admin-badge-danger">Disconnected</span>'}</span>
                  <span class="admin-property-label">In-Memory Sockets:</span>
                  <span class="admin-property-value"><strong>${d.activeConnectionCount}</strong></span>
                  <span class="admin-property-label">In-Memory Devices:</span>
                  <span class="admin-property-value"><strong>${d.inMemoryConnectedDevices}</strong></span>
                </div>
              </div>

              <div class="admin-card">
                <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Connection State Distribution</h3>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                  <span class="admin-badge admin-badge-success">CONNECTED: ${d.connectionStateDistribution?.CONNECTED || 0}</span>
                  <span class="admin-badge admin-badge-neutral">DISCONNECTED: ${d.connectionStateDistribution?.DISCONNECTED || 0}</span>
                  <span class="admin-badge admin-badge-warning">CONNECTING: ${d.connectionStateDistribution?.CONNECTING || 0}</span>
                  <span class="admin-badge admin-badge-danger">FAILED: ${d.connectionStateDistribution?.FAILED || 0}</span>
                </div>
              </div>
            </div>
          `;
        } catch (err) {
          container.innerHTML = `<p style="color:var(--admin-danger);">${this._escape(err.message || 'Failed to load diagnostics')}</p>`;
        }
      } else if (this.gatewayActiveTab === 'connections') {
        container.innerHTML = `
          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Device Name</th>
                    <th>Remote Endpoint</th>
                    <th>Gateway Hostname</th>
                    <th>Status</th>
                    <th>Connected At</th>
                    <th>Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody id="gatewayConnTableBody">
                  <tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading tunnel connections...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="gatewayConnPaginationBar" class="admin-pagination-bar"></div>
          </div>
        `;
        this.loadGatewayConnections();
      }
    }

    async loadGatewayNodes() {
      const tbody = document.getElementById('gatewayNodeTableBody');
      if (!tbody) return;

      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/nodes?page=${this.gatewayState.page}&pageSize=${this.gatewayState.pageSize}`);
        const data = res.data;
        this.gatewayState.items = data.items || [];
        this.gatewayState.total = data.total || 0;

        if (this.gatewayState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No gateway nodes registered.</td></tr>`;
          return;
        }

        const canDrain = window.AdminAuth.hasPermission('gateway.drain');
        const canWrite = window.AdminAuth.hasPermission('gateway.write');

        tbody.innerHTML = this.gatewayState.items.map(n => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(n.hostname)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(n.id)}</div>
            </td>
            <td>${this._escape(n.region || 'Global')}</td>
            <td>${this._renderStatusBadge(n.status)}</td>
            <td><strong>${n.activeConnectionCount}</strong></td>
            <td>${n.totalConnectionCount}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toLocaleString() : 'Never'}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectGatewayNode('${n.id}')" title="Inspect node">
                  ${ICONS.eye} Inspect
                </button>
                ${canDrain && n.status !== 'MAINTENANCE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmDrainGatewayNode('${n.id}', '${this._escape(n.hostname)}')" title="Drain node">
                    Drain
                  </button>
                ` : ''}
                ${canWrite && (n.status === 'MAINTENANCE' || n.status === 'INACTIVE') ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.confirmRestoreGatewayNode('${n.id}', '${this._escape(n.hostname)}')" title="Restore node">
                    Restore
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('gatewayNodePaginationBar', this.gatewayState, (p) => { this.gatewayState.page = p; this.loadGatewayNodes(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load gateway nodes')}</td></tr>`;
      }
    }

    async inspectGatewayNode(nodeId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/nodes/${nodeId}`);
        const node = res.data.node;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Node Metadata</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Node ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(node.id)}</code></span>
              <span class="admin-property-label">Hostname:</span>
              <span class="admin-property-value"><strong>${this._escape(node.hostname)}</strong></span>
              <span class="admin-property-label">Region:</span>
              <span class="admin-property-value">${this._escape(node.region || 'Global')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(node.status)}</span>
              <span class="admin-property-label">Active Tunnels:</span>
              <span class="admin-property-value"><strong>${node.activeConnectionCount}</strong> active</span>
              <span class="admin-property-label">Heartbeat Age:</span>
              <span class="admin-property-value">${node.health.lastHeartbeatAgeSeconds !== null ? `${node.health.lastHeartbeatAgeSeconds}s ago` : 'None'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Active Device Connections (${node.activeConnections.length})</div>
            ${node.activeConnections.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${node.activeConnections.map(c => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(c.deviceName)}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);"><code class="admin-code-pill">${this._escape(c.remoteEndpoint || '—')}</code></div>
                    </div>
                    ${this._renderStatusBadge(c.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No active device connections on this node.</p>'}
          </div>
        `;

        this._showDrawer(`Gateway Node: ${node.hostname}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect gateway node', 'danger');
      }
    }

    confirmDrainGatewayNode(nodeId, hostname) {
      this.showConfirmModal({
        title: 'Drain Gateway Node',
        message: `Draining gateway node <strong>${this._escape(hostname)}</strong> will place it into MAINTENANCE mode and evict all active client tunnel connections.`,
        warningText: 'Active proxy traffic on this specific node will be disconnected.',
        confirmLabel: 'Drain Node',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/gateway/nodes/${nodeId}/drain`, { reason });
          this.toast(`Gateway node '${hostname}' drained successfully.`, 'success');
          this.loadGatewayNodes();
        }
      });
    }

    confirmRestoreGatewayNode(nodeId, hostname) {
      this.showConfirmModal({
        title: 'Restore Gateway Node',
        message: `Restore gateway node <strong>${this._escape(hostname)}</strong> back to ACTIVE status?`,
        confirmLabel: 'Restore Node',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/gateway/nodes/${nodeId}/restore`, { reason });
          this.toast(`Gateway node '${hostname}' restored successfully.`, 'success');
          this.loadGatewayNodes();
        }
      });
    }

    async loadGatewayConnections() {
      const tbody = document.getElementById('gatewayConnTableBody');
      if (!tbody) return;

      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/connections?page=${this.connectionsState.page}&pageSize=${this.connectionsState.pageSize}`);
        const data = res.data;
        this.connectionsState.items = data.items || [];
        this.connectionsState.total = data.total || 0;

        if (this.connectionsState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No connection records found.</td></tr>`;
          return;
        }

        tbody.innerHTML = this.connectionsState.items.map(c => `
          <tr>
            <td><strong>${this._escape(c.deviceName)}</strong></td>
            <td><code class="admin-code-pill">${this._escape(c.remoteEndpoint || '—')}</code></td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(c.gatewayHostname || '—')}</span></td>
            <td>${this._renderStatusBadge(c.status)}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${c.connectedAt ? new Date(c.connectedAt).toLocaleString() : '—'}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt).toLocaleString() : '—'}</td>
          </tr>
        `).join('');

        this._renderPagination('gatewayConnPaginationBar', this.connectionsState, (p) => { this.connectionsState.page = p; this.loadGatewayConnections(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load connections')}</td></tr>`;
      }
    }

    /* =========================================================================
       6. ROLES & RBAC MATRIX VIEW
       ========================================================================= */
    _renderRolesView(container) {
      const roles = window.AdminAuth.roles || [];
      const permissions = window.AdminAuth.permissions || [];
      const isSuper = window.AdminAuth.isSuperAdmin;

      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Roles & RBAC Matrix</h1>
            <p>Inspect administrative roles, assignments, and granular security privileges.</p>
          </div>
        </div>

        <div class="admin-grid-2">
          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Assigned Administrative Roles</h3>
            <div style="display:flex;flex-direction:column;gap:0.75rem;">
              ${roles.map(r => {
                const roleName = typeof r === 'string' ? r : (r.name || r.slug || 'ADMIN');
                const roleDesc = typeof r === 'string' ? (r === 'SUPER_ADMIN' ? 'Full administrative authority with unrestricted wildcard access' : 'System administrative role') : (r.description || 'System administrative role');
                const isSuperRole = roleName === 'SUPER_ADMIN' || isSuper;
                return `
                <div style="background:var(--admin-bg-base);padding:0.875rem 1rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                    <strong style="font-size:0.9375rem;color:var(--admin-text-primary);">${this._escape(roleName)}</strong>
                    <span class="admin-role-badge ${isSuperRole ? 'super-admin' : ''}">${this._escape(roleName)}</span>
                  </div>
                  <p style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(roleDesc)}</p>
                </div>
              `;
              }).join('') || '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No explicit roles assigned.</p>'}
            </div>
          </div>

          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Effective Permission Catalog</h3>
            <p style="font-size:0.8125rem;color:var(--admin-text-secondary);margin-bottom:1rem;">
              Total Permissions Granted: <strong>${isSuper ? 'ALL (Wildcard)' : permissions.length}</strong>
            </p>
            <div class="admin-permission-grid">
              ${isSuper
                ? `<span class="admin-perm-tag wildcard">SuperAdmin Wildcard (*) — Full Authority</span>`
                : permissions.map(p => `<span class="admin-perm-tag granted">${ICONS.check} ${this._escape(p)}</span>`).join('')
              }
            </div>
          </div>
        </div>
      `;
    }

    /* =========================================================================
       7. SECURITY AUDIT LOGS VIEW
       ========================================================================= */
    async _renderAuditLogsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Security Audit Logs</h1>
            <p>Tamper-evident, cryptographically chained event log records and integrity verification.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="verifyChainBtn" onclick="AdminShell.verifyAuditIntegrity()">
              ${ICONS.shield} Verify Integrity Chain
            </button>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.exportAuditLogs('csv')">
              ${ICONS['file-text']} Export CSV
            </button>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadAuditLogs()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div id="auditIntegrityBanner" style="display:none;margin-bottom:var(--space-md);"></div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="auditSearchInput" class="admin-search-input" placeholder="Search by actor, IP, or metadata..." value="${this._escape(this.auditState.search)}">
            </div>
            <select id="auditActionSelect" class="admin-select">
              <option value="" ${this.auditState.action === '' ? 'selected' : ''}>All Actions</option>
              <option value="USER_LOGIN" ${this.auditState.action === 'USER_LOGIN' ? 'selected' : ''}>USER_LOGIN</option>
              <option value="ADMIN_LOGIN" ${this.auditState.action === 'ADMIN_LOGIN' ? 'selected' : ''}>ADMIN_LOGIN</option>
              <option value="USER_SUSPEND" ${this.auditState.action === 'USER_SUSPEND' ? 'selected' : ''}>USER_SUSPEND</option>
              <option value="USER_ACTIVATE" ${this.auditState.action === 'USER_ACTIVATE' ? 'selected' : ''}>USER_ACTIVATE</option>
              <option value="DEVICE_DEACTIVATE" ${this.auditState.action === 'DEVICE_DEACTIVATE' ? 'selected' : ''}>DEVICE_DEACTIVATE</option>
              <option value="DEVICE_DELETE" ${this.auditState.action === 'DEVICE_DELETE' ? 'selected' : ''}>DEVICE_DELETE</option>
              <option value="SERVER_RESTART" ${this.auditState.action === 'SERVER_RESTART' ? 'selected' : ''}>SERVER_RESTART</option>
              <option value="SERVER_STOP" ${this.auditState.action === 'SERVER_STOP' ? 'selected' : ''}>SERVER_STOP</option>
              <option value="GATEWAY_DRAIN" ${this.auditState.action === 'GATEWAY_DRAIN' ? 'selected' : ''}>GATEWAY_DRAIN</option>
              <option value="GATEWAY_UNDRAIN" ${this.auditState.action === 'GATEWAY_UNDRAIN' ? 'selected' : ''}>GATEWAY_UNDRAIN</option>
              <option value="GATEWAY_SESSION_TERMINATE" ${this.auditState.action === 'GATEWAY_SESSION_TERMINATE' ? 'selected' : ''}>GATEWAY_SESSION_TERMINATE</option>
            </select>
            <select id="auditStatusSelect" class="admin-select">
              <option value="" ${this.auditState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="SUCCESS" ${this.auditState.status === 'SUCCESS' ? 'selected' : ''}>SUCCESS</option>
              <option value="FAILED" ${this.auditState.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor / Administrator</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>IP Address</th>
                  <th>SHA-256 Integrity</th>
                  <th style="text-align:right;">Details</th>
                </tr>
              </thead>
              <tbody id="auditTableBody">
                <tr><td colspan="7" class="admin-table-loading">Loading security audit records...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="admin-pagination" id="auditPagination"></div>
        </div>
      `;

      const searchInput = document.getElementById('auditSearchInput');
      const actionSelect = document.getElementById('auditActionSelect');
      const statusSelect = document.getElementById('auditStatusSelect');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.auditState.search = e.target.value.trim();
            this.auditState.page = 1;
            this.loadAuditLogs();
          }, 350);
        });
      }

      if (actionSelect) {
        actionSelect.addEventListener('change', (e) => {
          this.auditState.action = e.target.value;
          this.auditState.page = 1;
          this.loadAuditLogs();
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.auditState.status = e.target.value;
          this.auditState.page = 1;
          this.loadAuditLogs();
        });
      }

      await this.loadAuditLogs();
    }

    async loadAuditLogs() {
      const tbody = document.getElementById('auditTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" class="admin-table-loading">Querying immutable audit records...</td></tr>`;

      try {
        const params = new URLSearchParams({
          page: this.auditState.page,
          limit: this.auditState.limit
        });

        if (this.auditState.search) params.append('search', this.auditState.search);
        if (this.auditState.action) params.append('action', this.auditState.action);
        if (this.auditState.status) params.append('status', this.auditState.status);

        const res = await window.AdminApi.get(`/admin/audit-logs?${params.toString()}`);
        const data = res.data || {};
        const records = data.records || [];
        this.auditState.total = data.total || records.length;
        this.auditState.items = records;

        if (records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="admin-table-empty">No security audit records match the current filters.</td></tr>`;
          return;
        }

        tbody.innerHTML = records.map(item => {
          const dateStr = new Date(item.createdAt).toLocaleString();
          const actorDisplay = item.admin ? (item.admin.email || item.admin.name || item.admin.id) : (item.adminId || 'System / Anonymous');
          const shortHash = item.hash ? `${item.hash.substring(0, 8)}...${item.hash.substring(item.hash.length - 6)}` : 'GENESIS';
          const isSuccess = item.status === 'SUCCESS';

          return `
            <tr>
              <td style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(dateStr)}</td>
              <td>
                <div style="font-weight:600;font-size:0.875rem;">${this._escape(actorDisplay)}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);font-family:var(--font-mono);">${this._escape(item.adminId || 'SYSTEM')}</div>
              </td>
              <td><span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);font-size:0.75rem;">${this._escape(item.action)}</span></td>
              <td><span class="admin-badge ${isSuccess ? 'admin-badge-success' : 'admin-badge-danger'}">${this._escape(item.status || 'UNKNOWN')}</span></td>
              <td style="font-family:var(--font-mono);font-size:0.8125rem;">${this._escape(item.ipAddress || '—')}</td>
              <td>
                <span class="admin-badge admin-badge-neutral" style="font-family:var(--font-mono);font-size:0.75rem;" title="${this._escape(item.hash || '')}">
                  ${item.isGenesis ? '🌟 GENESIS' : this._escape(shortHash)}
                </span>
              </td>
              <td style="text-align:right;">
                <button class="admin-btn-icon" onclick="AdminShell.inspectAuditRecord('${this._escape(item.id)}')" title="Inspect Record Payload">
                  ${ICONS.eye}
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('auditPagination', {
          total: this.auditState.total,
          page: this.auditState.page,
          pageSize: this.auditState.limit
        }, (newPage) => {
          this.auditState.page = newPage;
          this.loadAuditLogs();
        });

      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load audit records')}</td></tr>`;
      }
    }

    inspectAuditRecord(id) {
      const item = this.auditState.items.find(x => x.id === id);
      if (!item) return;

      const dateStr = new Date(item.createdAt).toUTCString();
      const metaPretty = item.metadata ? JSON.stringify(item.metadata, null, 2) : 'No structured metadata recorded.';

      const content = `
        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0.75rem;border-bottom:1px solid var(--admin-border-subtle);">
            <div>
              <span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);">${this._escape(item.action)}</span>
              <span class="admin-badge ${item.status === 'SUCCESS' ? 'admin-badge-success' : 'admin-badge-danger'}" style="margin-left:0.5rem;">${this._escape(item.status)}</span>
            </div>
            <span style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(dateStr)}</span>
          </div>

          <div style="display:grid;grid-template-columns:120px 1fr;gap:0.5rem;font-size:0.875rem;">
            <strong style="color:var(--admin-text-secondary);">Record ID:</strong>
            <span style="font-family:var(--font-mono);">${this._escape(item.id)}</span>

            <strong style="color:var(--admin-text-secondary);">Actor Email:</strong>
            <span>${this._escape(item.admin?.email || item.adminId || 'System')}</span>

            <strong style="color:var(--admin-text-secondary);">IP Address:</strong>
            <span style="font-family:var(--font-mono);">${this._escape(item.ipAddress || '—')}</span>

            <strong style="color:var(--admin-text-secondary);">User Agent:</strong>
            <span style="font-size:0.8125rem;color:var(--admin-text-muted);">${this._escape(item.userAgent || '—')}</span>

            <strong style="color:var(--admin-text-secondary);">Previous Hash:</strong>
            <span style="font-family:var(--font-mono);font-size:0.75rem;word-break:break-all;">${this._escape(item.previousHash || 'GENESIS_HASH')}</span>

            <strong style="color:var(--admin-text-secondary);">Record Hash:</strong>
            <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--admin-primary);word-break:break-all;">${this._escape(item.hash || '—')}</span>
          </div>

          <div>
            <h4 style="font-size:0.875rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);">Sanitized Event Metadata</h4>
            <pre style="background:var(--admin-bg-subtle);padding:0.75rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border-subtle);font-family:var(--font-mono);font-size:0.8125rem;overflow-x:auto;max-height:220px;">${this._escape(metaPretty)}</pre>
          </div>
        </div>
      `;

      this._showDrawer(`Audit Record Details — ${item.action}`, content);
    }

    async verifyAuditIntegrity() {
      const banner = document.getElementById('auditIntegrityBanner');
      const btn = document.getElementById('verifyChainBtn');
      if (btn) btn.disabled = true;

      try {
        this.toast('Executing cryptographic SHA-256 chain verification...', 'info');
        const res = await window.AdminApi.post('/admin/audit-logs/verify-integrity', {});
        const data = res.data || {};

        if (banner) {
          banner.style.display = 'block';
          if (data.isValid) {
            banner.innerHTML = `
              <div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:0.875rem 1rem;border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.75rem;">
                ${ICONS.shield}
                <div>
                  <strong>Cryptographic Integrity Verified:</strong> All ${data.verifiedRecords || 0} audit records match SHA-256 chain hashes from Genesis root. No tampering detected.
                </div>
              </div>
            `;
            this.toast('Audit log chain integrity is 100% VALID.', 'success');
          } else {
            banner.innerHTML = `
              <div style="background:#fef2f2;border:1px solid #ef4444;color:#991b1b;padding:0.875rem 1rem;border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.75rem;">
                ${ICONS.alert}
                <div>
                  <strong>Integrity Violation Detected:</strong> Audit log hash mismatch found! (${(data.errors || []).join(', ')})
                </div>
              </div>
            `;
            this.toast('Audit log integrity check detected a hash mismatch!', 'danger');
          }
        }
      } catch (err) {
        this.toast(err.message || 'Integrity verification failed', 'danger');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async exportAuditLogs(format = 'csv') {
      try {
        this.toast(`Preparing audit export in ${format.toUpperCase()} format...`, 'info');
        const params = new URLSearchParams({ format });
        if (this.auditState.action) params.append('action', this.auditState.action);
        if (this.auditState.status) params.append('status', this.auditState.status);
        const res = await fetch(`/api/v1/admin/audit-logs/export?${params.toString()}`, {
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error(`Export failed with HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${Date.now()}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        this.toast('Audit export downloaded successfully.', 'success');
      } catch (err) {
        this.toast(err.message || 'Audit export failed', 'danger');
      }
    }

    /* =========================================================================
       6B. SUBSCRIPTIONS & DUNNING MANAGEMENT VIEW (Phase 9 - Batch 9.2)
       ========================================================================= */
    _renderSubscriptionsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Subscriptions & Dunning Operations</h1>
            <p class="admin-view-subtitle">Inspect subscription lifecycles, monitor dunning grace periods, diagnose provider sync, and execute safe lifecycle actions.</p>
          </div>
          <div class="admin-view-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshSubscriptionsBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-filter-bar">
          <div class="admin-search-wrap">
            ${ICONS.search}
            <input type="text" id="subscriptionSearchInput" class="admin-search-input" placeholder="Search by email, subscription ID, or customer ID..." value="${this._escape(this.subscriptionState.search)}">
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="subscriptionPlanSelect" class="admin-select">
              <option value="" ${!this.subscriptionState.planCode ? 'selected' : ''}>All Plans</option>
              <option value="FREE" ${this.subscriptionState.planCode === 'FREE' ? 'selected' : ''}>FREE</option>
              <option value="PRO_MONTHLY" ${this.subscriptionState.planCode === 'PRO_MONTHLY' ? 'selected' : ''}>PRO_MONTHLY</option>
              <option value="PRO_YEARLY" ${this.subscriptionState.planCode === 'PRO_YEARLY' ? 'selected' : ''}>PRO_YEARLY</option>
            </select>
            <select id="subscriptionStatusSelect" class="admin-select">
              <option value="" ${!this.subscriptionState.status ? 'selected' : ''}>All Statuses</option>
              <option value="ACTIVE" ${this.subscriptionState.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="PAST_DUE" ${this.subscriptionState.status === 'PAST_DUE' ? 'selected' : ''}>PAST_DUE</option>
              <option value="GRACE_PERIOD" ${this.subscriptionState.status === 'GRACE_PERIOD' ? 'selected' : ''}>GRACE_PERIOD</option>
              <option value="CANCELLING" ${this.subscriptionState.status === 'CANCELLING' ? 'selected' : ''}>CANCELLING</option>
              <option value="EXPIRED" ${this.subscriptionState.status === 'EXPIRED' ? 'selected' : ''}>EXPIRED</option>
              <option value="UNPAID" ${this.subscriptionState.status === 'UNPAID' ? 'selected' : ''}>UNPAID</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Customer / ID</th>
                  <th>Plan & Price</th>
                  <th>Interval</th>
                  <th>Lifecycle Status</th>
                  <th>Dunning & Grace</th>
                  <th>Period End</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="subscriptionTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading subscriptions...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="subscriptionPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('subscriptionSearchInput');
      const planSelect = document.getElementById('subscriptionPlanSelect');
      const statusSelect = document.getElementById('subscriptionStatusSelect');
      const refreshBtn = document.getElementById('refreshSubscriptionsBtn');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.subscriptionState.search = e.target.value.trim();
            this.subscriptionState.page = 1;
            this.loadSubscriptions();
          }, 300);
        });
      }

      if (planSelect) {
        planSelect.addEventListener('change', (e) => {
          this.subscriptionState.planCode = e.target.value;
          this.subscriptionState.page = 1;
          this.loadSubscriptions();
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.subscriptionState.status = e.target.value;
          this.subscriptionState.page = 1;
          this.loadSubscriptions();
        });
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadSubscriptions());
      }

      this.loadSubscriptions();
    }

    async loadSubscriptions() {
      const tbody = document.getElementById('subscriptionTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading subscriptions...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.subscriptionState.page.toString(),
          pageSize: this.subscriptionState.pageSize.toString()
        });
        if (this.subscriptionState.search) queryParams.set('search', this.subscriptionState.search);
        if (this.subscriptionState.status) queryParams.set('status', this.subscriptionState.status);
        if (this.subscriptionState.planCode) queryParams.set('planCode', this.subscriptionState.planCode);

        const res = await window.AdminApi.get(`/admin/operations/billing/subscriptions?${queryParams.toString()}`);
        const data = res.data;
        this.subscriptionState.items = data.items || [];
        this.subscriptionState.total = data.total || 0;

        if (this.subscriptionState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['credit-card']}
                  <div class="admin-empty-title">No subscriptions found</div>
                  <div class="admin-empty-desc">No customer subscriptions matched your query and filter criteria.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('subscriptionPaginationBar', this.subscriptionState, (p) => { this.subscriptionState.page = p; this.loadSubscriptions(); });
          return;
        }

        const canCancel = window.AdminAuth.hasPermission('billing.write');

        tbody.innerHTML = this.subscriptionState.items.map(s => {
          const isDunning = s.dunningState && s.dunningState.isDunning;
          const graceDays = s.dunningState ? s.dunningState.gracePeriodDaysRemaining : null;
          let dunningBadge = '<span class="admin-badge admin-badge-neutral">Clean</span>';
          if (isDunning) {
            dunningBadge = `<span class="admin-badge admin-badge-warning" title="Dunning Grace Period Active">Grace (${graceDays !== null ? graceDays + 'd' : 'Active'})</span>`;
          } else if (s.status === 'PAST_DUE' || s.status === 'UNPAID') {
            dunningBadge = `<span class="admin-badge admin-badge-danger">Past Due</span>`;
          }

          const priceFormatted = s.price ? `${(s.price / 100).toFixed(2)} ${s.currency}` : '0.00 USD';
          const isCancelActive = s.status === 'ACTIVE' || s.status === 'PAST_DUE' || s.status === 'GRACE_PERIOD';

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);">${this._escape(s.userEmail)}</strong>
                <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(s.id)}</div>
              </td>
              <td>
                <strong>${this._escape(s.planCode)}</strong>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${priceFormatted}</div>
              </td>
              <td style="font-size:0.8125rem;">${this._escape(s.billingInterval || 'MONTHLY')}</td>
              <td>
                ${this._renderStatusBadge(s.status)}
                ${s.cancelAtPeriodEnd ? '<div style="font-size:0.6875rem;color:var(--admin-warning);margin-top:2px;">Cancels at term</div>' : ''}
              </td>
              <td>${dunningBadge}</td>
              <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : '—'}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:4px;">
                  <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectSubscription('${s.id}')" title="Inspect subscription & dunning lifecycle">
                    ${ICONS.eye} Inspect
                  </button>
                  ${canCancel && isCancelActive ? `
                    <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.showCancelSubscriptionModal('${s.id}', '${this._escape(s.userEmail)}', '${this._escape(s.planCode)}')" title="Cancel subscription">
                      Cancel
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('subscriptionPaginationBar', this.subscriptionState, (p) => { this.subscriptionState.page = p; this.loadSubscriptions(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load subscriptions')}</td></tr>`;
      }
    }

    async inspectSubscription(subId) {
      try {
        const [subRes, dunningRes, syncRes] = await Promise.all([
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}`),
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/dunning`).catch(() => ({ data: { dunning: null } })),
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/provider-sync`).catch(() => ({ data: { sync: null } }))
        ]);

        const sub = subRes.data.subscription;
        const entitlements = subRes.data.localEntitlements || {};
        const dunning = dunningRes.data.dunning;
        const sync = syncRes.data.sync;

        const priceDisplay = sub.price ? `${(sub.price / 100).toFixed(2)} ${sub.currency}` : '0.00';
        const canCancel = window.AdminAuth.hasPermission('billing.write') && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE' || sub.status === 'GRACE_PERIOD');

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Subscription Overview</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Subscription ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sub.id)}</code></span>
              <span class="admin-property-label">Customer Email:</span>
              <span class="admin-property-value"><strong>${this._escape(sub.userEmail || (sub.user ? sub.user.email : '—'))}</strong></span>
              <span class="admin-property-label">Customer ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sub.userId)}</code></span>
              <span class="admin-property-label">Plan Code:</span>
              <span class="admin-property-value"><strong>${this._escape(sub.planCode)}</strong></span>
              <span class="admin-property-label">Lifecycle Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(sub.status)}</span>
              <span class="admin-property-label">Price & Interval:</span>
              <span class="admin-property-value">${priceDisplay} / ${this._escape(sub.billingInterval)}</span>
              <span class="admin-property-label">Current Period:</span>
              <span class="admin-property-value">${sub.periodStart ? new Date(sub.periodStart).toLocaleDateString() : '—'} &rarr; ${sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString() : '—'}</span>
              <span class="admin-property-label">Auto Renewal:</span>
              <span class="admin-property-value">${sub.cancelAtPeriodEnd ? '<span style="color:var(--admin-warning);font-weight:600;">Canceling at period end</span>' : '<span style="color:var(--admin-success);font-weight:600;">Active Auto-Renew</span>'}</span>
              <span class="admin-property-label">Created At:</span>
              <span class="admin-property-value">${new Date(sub.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Effective Entitlements Matrix</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Plan Tier:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.planCode || sub.planCode)}</strong></span>
              <span class="admin-property-label">Max Active Devices:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.maxDevices ?? '—')}</strong></span>
              <span class="admin-property-label">Max Storage Quota:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.maxStorageGB ? entitlements.maxStorageGB + ' GB' : '—')}</strong></span>
              <span class="admin-property-label">High-Speed Relay:</span>
              <span class="admin-property-value">${entitlements.highSpeedRelay ? '<span class="admin-badge admin-badge-success">Enabled</span>' : '<span class="admin-badge admin-badge-neutral">Standard</span>'}</span>
              <span class="admin-property-label">Priority Support:</span>
              <span class="admin-property-value">${entitlements.prioritySupport ? '<span class="admin-badge admin-badge-success">Yes</span>' : '<span class="admin-badge admin-badge-neutral">Standard</span>'}</span>
            </div>
          </div>

          ${dunning ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Dunning & Grace Period Lifecycle</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Dunning Active:</span>
                <span class="admin-property-value">${dunning.isDunning ? '<span class="admin-badge admin-badge-warning">Active Grace Period</span>' : '<span class="admin-badge admin-badge-success">Healthy / None</span>'}</span>
                <span class="admin-property-label">Grace Days Remaining:</span>
                <span class="admin-property-value"><strong>${dunning.gracePeriodDaysRemaining !== null ? dunning.gracePeriodDaysRemaining + ' days' : 'N/A'}</strong></span>
                <span class="admin-property-label">Grace Expiry Date:</span>
                <span class="admin-property-value">${dunning.gracePeriodExpiry ? new Date(dunning.gracePeriodExpiry).toLocaleString() : 'N/A'}</span>
                <span class="admin-property-label">Failed Invoices:</span>
                <span class="admin-property-value"><strong>${dunning.failedPaymentCount}</strong></span>
                <span class="admin-property-label">Entitlement Impact:</span>
                <span class="admin-property-value" style="font-size:0.8125rem;">${this._escape(dunning.entitlementConsequence)}</span>
                <span class="admin-property-label">Recommended Triage:</span>
                <span class="admin-property-value" style="font-size:0.8125rem;color:var(--admin-warning);"><strong>${this._escape(dunning.recommendedAction)}</strong></span>
              </div>
            </div>
          ` : ''}

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Payment Provider (Razorpay) State</div>
            ${sync ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Provider Sub ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sync.providerSubscriptionId || 'None')}</code></span>
                <span class="admin-property-label">Provider Status:</span>
                <span class="admin-property-value">${this._escape(sync.providerStatus || 'UNKNOWN')}</span>
                <span class="admin-property-label">State Consistency:</span>
                <span class="admin-property-value">${sync.synced ? '<span class="admin-badge admin-badge-success">In Sync</span>' : '<span class="admin-badge admin-badge-danger">State Mismatch</span>'}</span>
                ${sync.mismatches && sync.mismatches.length > 0 ? `
                  <span class="admin-property-label">Mismatches:</span>
                  <span class="admin-property-value" style="color:var(--admin-danger);font-size:0.8125rem;">${this._escape(sync.mismatches.join('; '))}</span>
                ` : ''}
              </div>
              ${sync.livePayload ? `
                <div style="margin-top:0.75rem;">
                  <span style="font-size:0.75rem;font-weight:600;color:var(--admin-text-muted);display:block;margin-bottom:0.25rem;">Provider Metadata (Sanitized):</span>
                  <pre style="background:var(--admin-bg-base);padding:0.5rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);font-size:0.75rem;max-height:120px;overflow:auto;margin:0;"><code>${this._escape(JSON.stringify(sync.livePayload, null, 2))}</code></pre>
                </div>
              ` : ''}
            ` : '<p style="color:var(--admin-text-muted);font-size:0.8125rem;">No external payment provider record attached to this subscription.</p>'}
          </div>

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${canCancel ? `
              <button class="admin-btn admin-btn-danger" onclick="AdminShell.showCancelSubscriptionModal('${sub.id}', '${this._escape(sub.userEmail || (sub.user ? sub.user.email : ''))}', '${this._escape(sub.planCode)}')">
                Cancel Subscription
              </button>
            ` : ''}
            <button class="admin-btn admin-btn-secondary" onclick="AdminShell.syncProviderSubscription('${sub.id}')">
              ${ICONS['refresh-cw']} Re-check Provider Sync
            </button>
          </div>
        `;

        this._showDrawer(`Subscription: ${sub.planCode} (${sub.id.substring(0, 12)}...)`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect subscription', 'danger');
      }
    }

    showCancelSubscriptionModal(subId, userEmail, currentPlan) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:520px;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Administrative Subscription Cancellation</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;font-size:0.875rem;">
              You are initiating an administrative cancellation for account <strong>${this._escape(userEmail)}</strong> (${this._escape(currentPlan)}).
            </p>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.5rem;color:var(--admin-text-secondary);">
                Cancellation Enforcement Mode:
              </label>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.8125rem;cursor:pointer;padding:0.5rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);background:var(--admin-bg-base);">
                  <input type="radio" name="cancelModeRadio" value="PERIOD_END" checked style="margin-top:3px;">
                  <div>
                    <strong>End of Billing Period (Recommended)</strong>
                    <div style="color:var(--admin-text-muted);font-size:0.75rem;">Customer retains entitlements until their paid cycle expires. Auto-renewal is canceled.</div>
                  </div>
                </label>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.8125rem;cursor:pointer;padding:0.5rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);background:var(--admin-bg-base);">
                  <input type="radio" name="cancelModeRadio" value="IMMEDIATE" style="margin-top:3px;">
                  <div>
                    <strong style="color:var(--admin-danger);">Immediate Revocation</strong>
                    <div style="color:var(--admin-text-muted);font-size:0.75rem;">Cancels subscription instantly, revokes premium quota, and downgrades account to FREE tier.</div>
                  </div>
                </label>
              </div>
            </div>

            <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);margin-bottom:1rem;font-size:0.8125rem;color:var(--admin-warning);">
              <strong>Notice:</strong> This action is recorded in the immutable SHA-256 administrative audit log chain.
            </div>

            <div>
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Administrative Reason:
              </label>
              <input type="text" id="adminCancelReasonInput" class="admin-search-input" maxlength="255" placeholder="e.g. Customer support request, billing dispute, fraud..." style="padding-left:0.875rem;">
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-danger" id="adminModalConfirmCancelBtn">Confirm Cancellation</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmCancelBtn');
      const reasonInput = document.getElementById('adminCancelReasonInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const selectedMode = document.querySelector('input[name="cancelModeRadio"]:checked')?.value || 'PERIOD_END';
          const reason = reasonInput ? reasonInput.value.trim() : '';

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Cancelling...';

          try {
            await window.AdminApi.post(`/admin/operations/billing/subscriptions/${subId}/cancel`, {
              mode: selectedMode,
              reason: reason || undefined
            });

            this.toast(`Subscription canceled (${selectedMode}) successfully.`, 'success');
            closeModal();
            this._closeDrawer();
            this.loadSubscriptions();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Cancellation';
            this.toast(err.message || 'Failed to cancel subscription', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    async syncProviderSubscription(subId) {
      try {
        this.toast('Querying live provider synchronization state...', 'info');
        const res = await window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/provider-sync`);
        const sync = res.data.sync;
        if (sync.synced) {
          this.toast(`Subscription is in sync with provider (${sync.providerStatus}).`, 'success');
        } else {
          this.toast(`Mismatch detected: ${sync.mismatches ? sync.mismatches.join(', ') : 'Check details'}`, 'warning');
        }
        this.inspectSubscription(subId);
      } catch (err) {
        this.toast(err.message || 'Provider sync check failed', 'danger');
      }
    }

    /* =========================================================================
       6C. PAYMENTS & TRANSACTIONS MANAGEMENT VIEW (Phase 9 - Batch 9.3)
       ========================================================================= */
    _renderPaymentsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Payment Transactions Ledger</h1>
            <p class="admin-view-subtitle">Inspect customer transactions, verify upstream provider status, track fee/tax breakdowns, and execute refunds.</p>
          </div>
          <div class="admin-view-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshPaymentsBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-filter-bar">
          <div class="admin-search-wrap">
            ${ICONS.search}
            <input type="text" id="paymentSearchInput" class="admin-search-input" placeholder="Search by email, payment ID, or provider reference..." value="${this._escape(this.paymentState.search)}">
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="paymentStatusSelect" class="admin-select">
              <option value="" ${!this.paymentState.status ? 'selected' : ''}>All Statuses</option>
              <option value="SUCCESS" ${this.paymentState.status === 'SUCCESS' ? 'selected' : ''}>SUCCESS</option>
              <option value="PENDING" ${this.paymentState.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
              <option value="FAILED" ${this.paymentState.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
              <option value="REFUNDED" ${this.paymentState.status === 'REFUNDED' ? 'selected' : ''}>REFUNDED</option>
            </select>
            <select id="paymentCurrencySelect" class="admin-select">
              <option value="" ${!this.paymentState.currency ? 'selected' : ''}>All Currencies</option>
              <option value="INR" ${this.paymentState.currency === 'INR' ? 'selected' : ''}>INR (₹)</option>
              <option value="USD" ${this.paymentState.currency === 'USD' ? 'selected' : ''}>USD ($)</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Customer / Email</th>
                  <th>Amount</th>
                  <th>Lifecycle Status</th>
                  <th>Refund State</th>
                  <th>Provider Ref & Receipt</th>
                  <th>Charged At</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="paymentTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading payment transactions...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="paymentPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('paymentSearchInput');
      const statusSelect = document.getElementById('paymentStatusSelect');
      const currencySelect = document.getElementById('paymentCurrencySelect');
      const refreshBtn = document.getElementById('refreshPaymentsBtn');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.paymentState.search = e.target.value.trim();
            this.paymentState.page = 1;
            this.loadPayments();
          }, 300);
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.paymentState.status = e.target.value;
          this.paymentState.page = 1;
          this.loadPayments();
        });
      }

      if (currencySelect) {
        currencySelect.addEventListener('change', (e) => {
          this.paymentState.currency = e.target.value;
          this.paymentState.page = 1;
          this.loadPayments();
        });
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadPayments());
      }

      this.loadPayments();
    }

    async loadPayments() {
      const tbody = document.getElementById('paymentTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading payments...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.paymentState.page.toString(),
          pageSize: this.paymentState.pageSize.toString()
        });
        if (this.paymentState.search) queryParams.set('search', this.paymentState.search);
        if (this.paymentState.status) queryParams.set('status', this.paymentState.status);
        if (this.paymentState.currency) queryParams.set('currency', this.paymentState.currency);

        const res = await window.AdminApi.get(`/admin/operations/billing/payments?${queryParams.toString()}`);
        const data = res.data;
        this.paymentState.items = data.items || [];
        this.paymentState.total = data.total || 0;

        if (this.paymentState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['dollar-sign']}
                  <div class="admin-empty-title">No payment transactions found</div>
                  <div class="admin-empty-desc">No customer payment records matched your search and filter criteria.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('paymentPaginationBar', this.paymentState, (p) => { this.paymentState.page = p; this.loadPayments(); });
          return;
        }

        const canRefund = window.AdminAuth.hasPermission('billing.refund');

        tbody.innerHTML = this.paymentState.items.map(p => {
          const formattedAmount = `${(p.amountMinorUnits / 100).toFixed(2)} ${p.currency}`;
          const refundedAmount = p.refundedAmountMinorUnits || 0;
          const remainingMinor = p.amountMinorUnits - refundedAmount;

          let refundBadge = '<span class="admin-badge admin-badge-neutral">Clean</span>';
          if (p.status === 'REFUNDED' || remainingMinor <= 0) {
            refundBadge = '<span class="admin-badge admin-badge-danger">Fully Refunded</span>';
          } else if (refundedAmount > 0) {
            refundBadge = `<span class="admin-badge admin-badge-warning">Refunded: ${(refundedAmount / 100).toFixed(2)}</span>`;
          }

          const isEligibleForRefund = canRefund && p.status === 'SUCCESS' && remainingMinor > 0;

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);">${this._escape(p.userEmail)}</strong>
                <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(p.id)}</div>
              </td>
              <td>
                <strong>${formattedAmount}</strong>
                ${p.planCode ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(p.planCode)}</div>` : ''}
              </td>
              <td>${this._renderStatusBadge(p.status)}</td>
              <td>${refundBadge}</td>
              <td>
                <div style="font-size:0.8125rem;">${this._escape(p.providerPaymentId || '—')}</div>
                ${p.receiptNumber ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">Receipt: ${this._escape(p.receiptNumber)}</div>` : ''}
              </td>
              <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${p.chargedAt ? new Date(p.chargedAt).toLocaleString() : '—'}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:4px;">
                  <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectPayment('${p.id}')" title="Inspect payment & provider sync">
                    ${ICONS.eye} Inspect
                  </button>
                  ${isEligibleForRefund ? `
                    <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.showExecuteRefundModal('${p.id}', '${this._escape(p.userEmail)}', ${p.amountMinorUnits}, '${this._escape(p.currency)}', ${remainingMinor})" title="Issue administrative refund">
                      Refund
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('paymentPaginationBar', this.paymentState, (p) => { this.paymentState.page = p; this.loadPayments(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load payments')}</td></tr>`;
      }
    }

    async inspectPayment(paymentId) {
      try {
        const [payRes, syncRes] = await Promise.all([
          window.AdminApi.get(`/admin/operations/billing/payments/${paymentId}`),
          window.AdminApi.get(`/admin/operations/billing/payments/${paymentId}/provider-sync`).catch(() => ({ data: { sync: null } }))
        ]);

        const p = payRes.data;
        const sync = syncRes.data.sync;

        const totalFormatted = `${(p.amountMinorUnits / 100).toFixed(2)} ${p.currency}`;
        const refundedAmount = p.refundedAmountMinorUnits || 0;
        const remainingMinor = p.amountMinorUnits - refundedAmount;
        const canRefund = window.AdminAuth.hasPermission('billing.refund') && p.status === 'SUCCESS' && remainingMinor > 0;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Payment Overview</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Payment ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(p.id)}</code></span>
              <span class="admin-property-label">Customer Email:</span>
              <span class="admin-property-value"><strong>${this._escape(p.userEmail)}</strong></span>
              <span class="admin-property-label">Customer ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(p.userId)}</code></span>
              <span class="admin-property-label">Subscription ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(p.subscriptionId || 'One-off')}</code></span>
              <span class="admin-property-label">Plan Tier:</span>
              <span class="admin-property-value"><strong>${this._escape(p.planCode || 'N/A')}</strong></span>
              <span class="admin-property-label">Lifecycle Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(p.status)}</span>
              <span class="admin-property-label">Total Amount:</span>
              <span class="admin-property-value"><strong>${totalFormatted}</strong></span>
              <span class="admin-property-label">Charged Timestamp:</span>
              <span class="admin-property-value">${p.chargedAt ? new Date(p.chargedAt).toLocaleString() : '—'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Financial Breakdown & Taxes</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Receipt Number:</span>
              <span class="admin-property-value"><strong>${this._escape(p.receiptNumber || 'None')}</strong></span>
              <span class="admin-property-label">Tax Total:</span>
              <span class="admin-property-value">${p.totalTaxMinorUnits !== null ? `${(p.totalTaxMinorUnits / 100).toFixed(2)} ${p.currency}` : '0.00'}</span>
              <span class="admin-property-label">Processing Fee:</span>
              <span class="admin-property-value">${p.totalFeeMinorUnits !== null ? `${(p.totalFeeMinorUnits / 100).toFixed(2)} ${p.currency}` : '0.00'}</span>
              <span class="admin-property-label">Net Settlement:</span>
              <span class="admin-property-value"><strong>${p.processingFee && p.processingFee.netSettlementAmountMinorUnits !== null ? `${(p.processingFee.netSettlementAmountMinorUnits / 100).toFixed(2)} ${p.currency}` : totalFormatted}</strong></span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Refund Summary (${p.refunds ? p.refunds.length : 0})</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Cumulative Refunded:</span>
              <span class="admin-property-value">${(refundedAmount / 100).toFixed(2)} ${p.currency}</span>
              <span class="admin-property-label">Remaining Refundable:</span>
              <span class="admin-property-value"><strong>${(remainingMinor / 100).toFixed(2)} ${p.currency}</strong></span>
            </div>
            ${p.refunds && p.refunds.length > 0 ? `
              <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
                ${p.refunds.map(r => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="font-size:0.875rem;">${(r.amountMinorUnits / 100).toFixed(2)} ${r.currency}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(r.reason)} &bull; ${new Date(r.requestedAt).toLocaleDateString()}</div>
                    </div>
                    ${this._renderStatusBadge(r.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.8125rem;margin-top:0.5rem;">No refunds requested for this transaction.</p>'}
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Payment Provider (Razorpay) State</div>
            ${sync ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Provider Payment ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sync.providerPaymentId || 'None')}</code></span>
                <span class="admin-property-label">Provider Status:</span>
                <span class="admin-property-value">${this._escape(sync.providerState ? sync.providerState.status : 'UNKNOWN')}</span>
                <span class="admin-property-label">State Consistency:</span>
                <span class="admin-property-value">${sync.comparison && sync.comparison.isMatched ? '<span class="admin-badge admin-badge-success">In Sync</span>' : '<span class="admin-badge admin-badge-danger">State Mismatch</span>'}</span>
                ${sync.comparison && sync.comparison.mismatches && sync.comparison.mismatches.length > 0 ? `
                  <span class="admin-property-label">Mismatches:</span>
                  <span class="admin-property-value" style="color:var(--admin-danger);font-size:0.8125rem;">${this._escape(sync.comparison.mismatches.join('; '))}</span>
                ` : ''}
              </div>
              ${sync.providerState ? `
                <div style="margin-top:0.75rem;">
                  <span style="font-size:0.75rem;font-weight:600;color:var(--admin-text-muted);display:block;margin-bottom:0.25rem;">Provider Metadata (Sanitized):</span>
                  <pre style="background:var(--admin-bg-base);padding:0.5rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);font-size:0.75rem;max-height:120px;overflow:auto;margin:0;"><code>${this._escape(JSON.stringify(sync.providerState, null, 2))}</code></pre>
                </div>
              ` : ''}
            ` : '<p style="color:var(--admin-text-muted);font-size:0.8125rem;">No external payment provider record attached to this transaction.</p>'}
          </div>

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${canRefund ? `
              <button class="admin-btn admin-btn-danger" onclick="AdminShell.showExecuteRefundModal('${p.id}', '${this._escape(p.userEmail)}', ${p.amountMinorUnits}, '${this._escape(p.currency)}', ${remainingMinor})">
                Issue Refund
              </button>
            ` : ''}
            <button class="admin-btn admin-btn-secondary" onclick="AdminShell.syncProviderPayment('${p.id}')">
              ${ICONS['refresh-cw']} Re-check Provider Sync
            </button>
          </div>
        `;

        this._showDrawer(`Payment: ${p.id.substring(0, 12)}... (${totalFormatted})`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect payment', 'danger');
      }
    }

    showExecuteRefundModal(paymentId, userEmail, totalMinorUnits, currency, remainingMinorUnits) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      const maxRefundMajor = (remainingMinorUnits / 100).toFixed(2);
      const totalMajor = (totalMinorUnits / 100).toFixed(2);

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:540px;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Administrative Payment Refund</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <div style="background:var(--admin-bg-base);padding:0.75rem 1rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);margin-bottom:1rem;font-size:0.8125rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="color:var(--admin-text-muted);">Customer:</span>
                <strong>${this._escape(userEmail)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="color:var(--admin-text-muted);">Total Captured Amount:</span>
                <strong>${totalMajor} ${currency}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--admin-text-muted);">Available Refundable Balance:</span>
                <strong style="color:var(--admin-success);">${maxRefundMajor} ${currency}</strong>
              </div>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Refund Amount (${currency}):
              </label>
              <input type="number" id="adminRefundAmountInput" class="admin-search-input" min="0.01" max="${maxRefundMajor}" step="0.01" value="${maxRefundMajor}" style="padding-left:0.875rem;">
              <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:0.25rem;">
                Defaulted to full remaining balance (${maxRefundMajor} ${currency}). Enter a lower amount for partial refund.
              </div>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Refund Policy Reason:
              </label>
              <select id="adminRefundReasonSelect" class="admin-select" style="width:100%;">
                <option value="ADMIN_APPROVED_EXCEPTION">ADMIN_APPROVED_EXCEPTION (Administrative Discretion)</option>
                <option value="DUPLICATE_PAYMENT">DUPLICATE_PAYMENT (Accidental Duplicate Charge)</option>
                <option value="ERRONEOUS_PAYMENT">ERRONEOUS_PAYMENT (Incorrect Plan / Billing Error)</option>
                <option value="TECHNICAL_SERVICE_FAILURE">TECHNICAL_SERVICE_FAILURE (Platform Outage / Service Issue)</option>
                <option value="ANNUAL_WITHIN_REFUND_WINDOW">ANNUAL_WITHIN_REFUND_WINDOW (Annual 14-Day Cooling Period)</option>
                <option value="OTHER_APPROVED">OTHER_APPROVED (Customer Goodwill)</option>
              </select>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Administrative Notes / Reason Details:
              </label>
              <input type="text" id="adminRefundDetailsInput" class="admin-search-input" maxlength="255" placeholder="e.g. Support ticket #8921, approved by billing lead..." style="padding-left:0.875rem;">
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.8125rem;cursor:pointer;">
                <input type="checkbox" id="adminRefundTerminateSubCheckbox">
                <span>Terminate and expire customer subscription immediately</span>
              </label>
            </div>

            <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-size:0.8125rem;color:var(--admin-warning);">
              <strong>Warning:</strong> Executing a refund dispatches an irreversible external transaction to Razorpay and creates an immutable entry in the SHA-256 audit chain.
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-danger" id="adminModalConfirmRefundBtn">Execute Refund</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmRefundBtn');
      const amountInput = document.getElementById('adminRefundAmountInput');
      const reasonSelect = document.getElementById('adminRefundReasonSelect');
      const detailsInput = document.getElementById('adminRefundDetailsInput');
      const termSubCheckbox = document.getElementById('adminRefundTerminateSubCheckbox');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const rawAmount = parseFloat(amountInput.value);
          if (isNaN(rawAmount) || rawAmount <= 0) {
            this.toast('Please enter a valid refund amount greater than zero.', 'danger');
            return;
          }

          const amountMinorUnits = Math.round(rawAmount * 100);
          if (amountMinorUnits > remainingMinorUnits) {
            this.toast(`Refund amount cannot exceed remaining balance (${maxRefundMajor} ${currency}).`, 'danger');
            return;
          }

          const reason = reasonSelect.value;
          const reasonDetails = detailsInput ? detailsInput.value.trim() : '';
          const terminateSubscription = termSubCheckbox ? termSubCheckbox.checked : false;

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Executing Refund...';

          try {
            await window.AdminApi.post(`/admin/operations/billing/payments/${paymentId}/refund`, {
              amountMinorUnits,
              reason,
              reasonDetails: reasonDetails || undefined,
              terminateSubscription
            });

            this.toast(`Refund of ${(amountMinorUnits / 100).toFixed(2)} ${currency} executed successfully.`, 'success');
            closeModal();
            this._closeDrawer();
            this.loadPayments();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Execute Refund';
            this.toast(err.message || 'Refund execution failed', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    async syncProviderPayment(paymentId) {
      try {
        this.toast('Checking live provider transaction state...', 'info');
        const res = await window.AdminApi.get(`/admin/operations/billing/payments/${paymentId}/provider-sync`);
        const sync = res.data.sync;
        if (sync && sync.comparison && sync.comparison.isMatched) {
          this.toast(`Payment is in sync with provider (${sync.providerState ? sync.providerState.status : 'captured'}).`, 'success');
        } else {
          this.toast(`Mismatch detected: ${sync && sync.comparison && sync.comparison.mismatches ? sync.comparison.mismatches.join(', ') : 'Check details'}`, 'warning');
        }
        this.inspectPayment(paymentId);
      } catch (err) {
        this.toast(err.message || 'Provider sync check failed', 'danger');
      }
    }

    /* =========================================================================
       6D. REFUNDS & RETURNS MANAGEMENT VIEW (Phase 9 - Batch 9.3)
       ========================================================================= */
    _renderRefundsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Refunds & Returns Ledger</h1>
            <p class="admin-view-subtitle">Inspect customer refund requests, track Razorpay provider execution status, and analyze dispute reasons.</p>
          </div>
          <div class="admin-view-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshRefundsBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-filter-bar">
          <div class="admin-search-wrap">
            ${ICONS.search}
            <input type="text" id="refundSearchInput" class="admin-search-input" placeholder="Search by email, refund ID, provider refund ID, or payment ID..." value="${this._escape(this.refundState.search)}">
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="refundStatusSelect" class="admin-select">
              <option value="" ${!this.refundState.status ? 'selected' : ''}>All Statuses</option>
              <option value="PROCESSED" ${this.refundState.status === 'PROCESSED' ? 'selected' : ''}>PROCESSED</option>
              <option value="PROCESSING" ${this.refundState.status === 'PROCESSING' ? 'selected' : ''}>PROCESSING</option>
              <option value="REQUESTED" ${this.refundState.status === 'REQUESTED' ? 'selected' : ''}>REQUESTED</option>
              <option value="FAILED" ${this.refundState.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
            </select>
            <select id="refundReasonSelect" class="admin-select">
              <option value="" ${!this.refundState.reason ? 'selected' : ''}>All Reasons</option>
              <option value="ADMIN_APPROVED_EXCEPTION" ${this.refundState.reason === 'ADMIN_APPROVED_EXCEPTION' ? 'selected' : ''}>ADMIN_APPROVED_EXCEPTION</option>
              <option value="DUPLICATE_PAYMENT" ${this.refundState.reason === 'DUPLICATE_PAYMENT' ? 'selected' : ''}>DUPLICATE_PAYMENT</option>
              <option value="ERRONEOUS_PAYMENT" ${this.refundState.reason === 'ERRONEOUS_PAYMENT' ? 'selected' : ''}>ERRONEOUS_PAYMENT</option>
              <option value="TECHNICAL_SERVICE_FAILURE" ${this.refundState.reason === 'TECHNICAL_SERVICE_FAILURE' ? 'selected' : ''}>TECHNICAL_SERVICE_FAILURE</option>
              <option value="ANNUAL_WITHIN_REFUND_WINDOW" ${this.refundState.reason === 'ANNUAL_WITHIN_REFUND_WINDOW' ? 'selected' : ''}>ANNUAL_WITHIN_REFUND_WINDOW</option>
              <option value="OTHER_APPROVED" ${this.refundState.reason === 'OTHER_APPROVED' ? 'selected' : ''}>OTHER_APPROVED</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Refund ID / Customer</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Lifecycle Status</th>
                  <th>Requested By & Date</th>
                  <th>Provider Ref</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="refundTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading refunds...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="refundPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('refundSearchInput');
      const statusSelect = document.getElementById('refundStatusSelect');
      const reasonSelect = document.getElementById('refundReasonSelect');
      const refreshBtn = document.getElementById('refreshRefundsBtn');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.refundState.search = e.target.value.trim();
            this.refundState.page = 1;
            this.loadRefunds();
          }, 300);
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.refundState.status = e.target.value;
          this.refundState.page = 1;
          this.loadRefunds();
        });
      }

      if (reasonSelect) {
        reasonSelect.addEventListener('change', (e) => {
          this.refundState.reason = e.target.value;
          this.refundState.page = 1;
          this.loadRefunds();
        });
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadRefunds());
      }

      this.loadRefunds();
    }

    async loadRefunds() {
      const tbody = document.getElementById('refundTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading refunds...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.refundState.page.toString(),
          pageSize: this.refundState.pageSize.toString()
        });
        if (this.refundState.search) queryParams.set('search', this.refundState.search);
        if (this.refundState.status) queryParams.set('status', this.refundState.status);
        if (this.refundState.reason) queryParams.set('reason', this.refundState.reason);

        const res = await window.AdminApi.get(`/admin/operations/billing/refunds?${queryParams.toString()}`);
        const data = res.data;
        this.refundState.items = data.items || [];
        this.refundState.total = data.total || 0;

        if (this.refundState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['rotate-ccw']}
                  <div class="admin-empty-title">No refund records found</div>
                  <div class="admin-empty-desc">No customer refunds matched your search and filter criteria.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('refundPaginationBar', this.refundState, (p) => { this.refundState.page = p; this.loadRefunds(); });
          return;
        }

        tbody.innerHTML = this.refundState.items.map(r => {
          const formattedAmount = `${(r.amountMinorUnits / 100).toFixed(2)} ${r.currency}`;

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);">${this._escape(r.userEmail)}</strong>
                <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(r.id)}</div>
              </td>
              <td><strong>${formattedAmount}</strong></td>
              <td style="font-size:0.8125rem;">
                <div>${this._escape(r.reason)}</div>
                ${r.reasonDetails ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(r.reasonDetails)}</div>` : ''}
              </td>
              <td>${this._renderStatusBadge(r.status)}</td>
              <td style="font-size:0.8125rem;">
                <div>${this._escape(r.requestedBy || 'ADMIN')}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : '—'}</div>
              </td>
              <td style="font-size:0.8125rem;">
                <div>${this._escape(r.providerRefundId || '—')}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">Pay: ${this._escape(r.paymentId.substring(0, 8))}...</div>
              </td>
              <td style="text-align:right;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectRefund('${r.id}')" title="Inspect refund detail & provider sync">
                  ${ICONS.eye} Inspect
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('refundPaginationBar', this.refundState, (p) => { this.refundState.page = p; this.loadRefunds(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load refunds')}</td></tr>`;
      }
    }

    async inspectRefund(refundId) {
      try {
        const [refRes, syncRes] = await Promise.all([
          window.AdminApi.get(`/admin/operations/billing/refunds/${refundId}`),
          window.AdminApi.get(`/admin/operations/billing/refunds/${refundId}/provider-sync`).catch(() => ({ data: { sync: null } }))
        ]);

        const r = refRes.data;
        const sync = syncRes.data.sync;
        const formattedAmount = `${(r.amountMinorUnits / 100).toFixed(2)} ${r.currency}`;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Refund Overview</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Refund ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(r.id)}</code></span>
              <span class="admin-property-label">Customer Email:</span>
              <span class="admin-property-value"><strong>${this._escape(r.userEmail)}</strong></span>
              <span class="admin-property-label">Customer ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(r.userId)}</code></span>
              <span class="admin-property-label">Refund Amount:</span>
              <span class="admin-property-value"><strong>${formattedAmount}</strong></span>
              <span class="admin-property-label">Lifecycle Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(r.status)}</span>
              <span class="admin-property-label">Policy Reason:</span>
              <span class="admin-property-value"><strong>${this._escape(r.reason)}</strong></span>
              <span class="admin-property-label">Reason Details:</span>
              <span class="admin-property-value">${this._escape(r.reasonDetails || 'None provided')}</span>
              <span class="admin-property-label">Requested By:</span>
              <span class="admin-property-value">${this._escape(r.requestedBy || 'ADMIN')}</span>
              <span class="admin-property-label">Requested At:</span>
              <span class="admin-property-value">${r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '—'}</span>
              <span class="admin-property-label">Processed At:</span>
              <span class="admin-property-value">${r.providerProcessedAt ? new Date(r.providerProcessedAt).toLocaleString() : (r.status === 'PROCESSED' ? 'Processed' : 'Pending Provider')}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Associated Payment Record</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Payment ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(r.paymentId)}</code></span>
              <span class="admin-property-label">Original Amount:</span>
              <span class="admin-property-value"><strong>${r.payment ? `${(r.payment.amountMinorUnits / 100).toFixed(2)} ${r.payment.currency}` : '—'}</strong></span>
              <span class="admin-property-label">Payment Status:</span>
              <span class="admin-property-value">${r.payment ? this._renderStatusBadge(r.payment.status) : '—'}</span>
              <span class="admin-property-label">Charged At:</span>
              <span class="admin-property-value">${r.payment && r.payment.chargedAt ? new Date(r.payment.chargedAt).toLocaleString() : '—'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Payment Provider (Razorpay) State</div>
            ${sync ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Provider Refund ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sync.providerRefundId || 'None')}</code></span>
                <span class="admin-property-label">Provider Status:</span>
                <span class="admin-property-value">${this._escape(sync.providerState ? sync.providerState.status : 'UNKNOWN')}</span>
                <span class="admin-property-label">State Consistency:</span>
                <span class="admin-property-value">${sync.comparison && sync.comparison.isMatched ? '<span class="admin-badge admin-badge-success">In Sync</span>' : '<span class="admin-badge admin-badge-danger">State Mismatch</span>'}</span>
                ${sync.comparison && sync.comparison.mismatches && sync.comparison.mismatches.length > 0 ? `
                  <span class="admin-property-label">Mismatches:</span>
                  <span class="admin-property-value" style="color:var(--admin-danger);font-size:0.8125rem;">${this._escape(sync.comparison.mismatches.join('; '))}</span>
                ` : ''}
              </div>
              ${sync.providerState ? `
                <div style="margin-top:0.75rem;">
                  <span style="font-size:0.75rem;font-weight:600;color:var(--admin-text-muted);display:block;margin-bottom:0.25rem;">Provider Refund Payload (Sanitized):</span>
                  <pre style="background:var(--admin-bg-base);padding:0.5rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);font-size:0.75rem;max-height:120px;overflow:auto;margin:0;"><code>${this._escape(JSON.stringify(sync.providerState, null, 2))}</code></pre>
                </div>
              ` : ''}
            ` : '<p style="color:var(--admin-text-muted);font-size:0.8125rem;">No external provider refund record attached.</p>'}
          </div>

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            <button class="admin-btn admin-btn-secondary" onclick="AdminShell.syncProviderRefund('${r.id}')">
              ${ICONS['refresh-cw']} Re-check Provider Sync
            </button>
          </div>
        `;

        this._showDrawer(`Refund: ${formattedAmount} (${r.id.substring(0, 12)}...)`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect refund', 'danger');
      }
    }

    async syncProviderRefund(refundId) {
      try {
        this.toast('Checking live provider refund state...', 'info');
        const res = await window.AdminApi.get(`/admin/operations/billing/refunds/${refundId}/provider-sync`);
        const sync = res.data.sync;
        if (sync && sync.comparison && sync.comparison.isMatched) {
          this.toast(`Refund is in sync with provider (${sync.providerState ? sync.providerState.status : 'processed'}).`, 'success');
        } else {
          this.toast(`Mismatch detected: ${sync && sync.comparison && sync.comparison.mismatches ? sync.comparison.mismatches.join(', ') : 'Check details'}`, 'warning');
        }
        this.inspectRefund(refundId);
      } catch (err) {
        this.toast(err.message || 'Provider refund sync check failed', 'danger');
      }
    }

    /* =========================================================================
       6E. BILLING RECONCILIATION & DISCREPANCY MANAGEMENT VIEW (Phase 9 - Batch 9.4)
       ========================================================================= */
    _renderReconciliationView(container) {
      const canReconcile = window.AdminAuth.hasPermission('billing.reconcile');

      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Billing Reconciliation & Provider Drift Control</h1>
            <p class="admin-view-subtitle">Audit Razorpay ledger consistency, track financial discrepancy drift, reconcile settlements, and execute resolutions.</p>
          </div>
          <div class="admin-view-actions">
            ${canReconcile ? `
              <button class="admin-btn admin-btn-primary admin-btn-sm" id="startReconRunBtn">
                ${ICONS.play} Trigger Reconciliation Run
              </button>
            ` : ''}
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshReconBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-tab-nav" style="margin-bottom:1.5rem;display:flex;gap:0.5rem;border-bottom:1px solid var(--admin-border);">
          <button class="admin-btn ${this.reconciliationState.activeTab === 'runs' ? 'admin-btn-primary' : 'admin-btn-secondary'} admin-btn-sm" id="reconTabRunsBtn">
            Reconciliation Runs
          </button>
          <button class="admin-btn ${this.reconciliationState.activeTab === 'discrepancies' ? 'admin-btn-primary' : 'admin-btn-secondary'} admin-btn-sm" id="reconTabDiscrepanciesBtn">
            Discrepancies & Drift
          </button>
        </div>

        <div id="reconRunsTabContent" style="display:${this.reconciliationState.activeTab === 'runs' ? 'block' : 'none'};">
          <div class="admin-filter-bar">
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <select id="reconRunStatusSelect" class="admin-select">
                <option value="" ${!this.reconciliationState.status ? 'selected' : ''}>All Run Statuses</option>
                <option value="COMPLETED" ${this.reconciliationState.status === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
                <option value="RUNNING" ${this.reconciliationState.status === 'RUNNING' ? 'selected' : ''}>RUNNING</option>
                <option value="FAILED" ${this.reconciliationState.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
                <option value="CANCELLED" ${this.reconciliationState.status === 'CANCELLED' ? 'selected' : ''}>CANCELLED</option>
              </select>
            </div>
          </div>

          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Run ID / Scope</th>
                    <th>Date Window</th>
                    <th>Processed / Matched</th>
                    <th>Discrepancies</th>
                    <th>Settlements Matched</th>
                    <th>Status</th>
                    <th>Started At & By</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="reconRunTableBody">
                  <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading reconciliation runs...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="reconRunPaginationBar" class="admin-pagination-bar"></div>
          </div>
        </div>

        <div id="reconDiscrepanciesTabContent" style="display:${this.reconciliationState.activeTab === 'discrepancies' ? 'block' : 'none'};">
          <div class="admin-filter-bar">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="discrepancySearchInput" class="admin-search-input" placeholder="Search by discrepancy ID, payment ID, or provider reference..." value="${this._escape(this.discrepancyState.search)}">
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <select id="discrepancyStatusSelect" class="admin-select">
                <option value="" ${!this.discrepancyState.status ? 'selected' : ''}>All Statuses</option>
                <option value="OPEN" ${this.discrepancyState.status === 'OPEN' ? 'selected' : ''}>OPEN</option>
                <option value="ACKNOWLEDGED" ${this.discrepancyState.status === 'ACKNOWLEDGED' ? 'selected' : ''}>ACKNOWLEDGED</option>
                <option value="RESOLVED" ${this.discrepancyState.status === 'RESOLVED' ? 'selected' : ''}>RESOLVED</option>
                <option value="IGNORED" ${this.discrepancyState.status === 'IGNORED' ? 'selected' : ''}>IGNORED</option>
              </select>
              <select id="discrepancyTypeSelect" class="admin-select">
                <option value="" ${!this.discrepancyState.discrepancyType ? 'selected' : ''}>All Discrepancy Types</option>
                <option value="AMOUNT_MISMATCH" ${this.discrepancyState.discrepancyType === 'AMOUNT_MISMATCH' ? 'selected' : ''}>AMOUNT_MISMATCH</option>
                <option value="STATUS_MISMATCH" ${this.discrepancyState.discrepancyType === 'STATUS_MISMATCH' ? 'selected' : ''}>STATUS_MISMATCH</option>
                <option value="MISSING_IN_LOCAL" ${this.discrepancyState.discrepancyType === 'MISSING_IN_LOCAL' ? 'selected' : ''}>MISSING_IN_LOCAL</option>
                <option value="MISSING_IN_PROVIDER" ${this.discrepancyState.discrepancyType === 'MISSING_IN_PROVIDER' ? 'selected' : ''}>MISSING_IN_PROVIDER</option>
                <option value="SETTLEMENT_MISMATCH" ${this.discrepancyState.discrepancyType === 'SETTLEMENT_MISMATCH' ? 'selected' : ''}>SETTLEMENT_MISMATCH</option>
                <option value="FEE_MISMATCH" ${this.discrepancyState.discrepancyType === 'FEE_MISMATCH' ? 'selected' : ''}>FEE_MISMATCH</option>
                <option value="REFUND_MISMATCH" ${this.discrepancyState.discrepancyType === 'REFUND_MISMATCH' ? 'selected' : ''}>REFUND_MISMATCH</option>
              </select>
            </div>
          </div>

          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Discrepancy / Type</th>
                    <th>Severity</th>
                    <th>Entity Reference</th>
                    <th>Local vs Provider Detail</th>
                    <th>Lifecycle Status</th>
                    <th>Discovered At</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="discrepancyTableBody">
                  <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading discrepancies...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="discrepancyPaginationBar" class="admin-pagination-bar"></div>
          </div>
        </div>
      `;

      const startRunBtn = document.getElementById('startReconRunBtn');
      const refreshBtn = document.getElementById('refreshReconBtn');
      const tabRunsBtn = document.getElementById('reconTabRunsBtn');
      const tabDiscrepanciesBtn = document.getElementById('reconTabDiscrepanciesBtn');
      const runsContent = document.getElementById('reconRunsTabContent');
      const discrepanciesContent = document.getElementById('reconDiscrepanciesTabContent');

      if (startRunBtn) {
        startRunBtn.addEventListener('click', () => this.showStartReconciliationModal());
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          if (this.reconciliationState.activeTab === 'runs') {
            this.loadReconciliationRuns();
          } else {
            this.loadDiscrepancies();
          }
        });
      }

      if (tabRunsBtn && tabDiscrepanciesBtn) {
        tabRunsBtn.addEventListener('click', () => {
          this.reconciliationState.activeTab = 'runs';
          tabRunsBtn.className = 'admin-btn admin-btn-primary admin-btn-sm';
          tabDiscrepanciesBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
          runsContent.style.display = 'block';
          discrepanciesContent.style.display = 'none';
          this.loadReconciliationRuns();
        });

        tabDiscrepanciesBtn.addEventListener('click', () => {
          this.reconciliationState.activeTab = 'discrepancies';
          tabDiscrepanciesBtn.className = 'admin-btn admin-btn-primary admin-btn-sm';
          tabRunsBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
          discrepanciesContent.style.display = 'block';
          runsContent.style.display = 'none';
          this.loadDiscrepancies();
        });
      }

      const runStatusSelect = document.getElementById('reconRunStatusSelect');
      if (runStatusSelect) {
        runStatusSelect.addEventListener('change', (e) => {
          this.reconciliationState.status = e.target.value;
          this.reconciliationState.page = 1;
          this.loadReconciliationRuns();
        });
      }

      const discSearchInput = document.getElementById('discrepancySearchInput');
      const discStatusSelect = document.getElementById('discrepancyStatusSelect');
      const discTypeSelect = document.getElementById('discrepancyTypeSelect');

      let discDebounce = null;
      if (discSearchInput) {
        discSearchInput.addEventListener('input', (e) => {
          clearTimeout(discDebounce);
          discDebounce = setTimeout(() => {
            this.discrepancyState.search = e.target.value.trim();
            this.discrepancyState.page = 1;
            this.loadDiscrepancies();
          }, 300);
        });
      }

      if (discStatusSelect) {
        discStatusSelect.addEventListener('change', (e) => {
          this.discrepancyState.status = e.target.value;
          this.discrepancyState.page = 1;
          this.loadDiscrepancies();
        });
      }

      if (discTypeSelect) {
        discTypeSelect.addEventListener('change', (e) => {
          this.discrepancyState.discrepancyType = e.target.value;
          this.discrepancyState.page = 1;
          this.loadDiscrepancies();
        });
      }

      if (this.reconciliationState.activeTab === 'runs') {
        this.loadReconciliationRuns();
      } else {
        this.loadDiscrepancies();
      }
    }

    async loadReconciliationRuns() {
      const tbody = document.getElementById('reconRunTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading reconciliation runs...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.reconciliationState.page.toString(),
          pageSize: this.reconciliationState.pageSize.toString()
        });
        if (this.reconciliationState.status) queryParams.set('status', this.reconciliationState.status);

        const res = await window.AdminApi.get(`/admin/operations/billing/reconciliation/runs?${queryParams.toString()}`);
        const data = res.data;
        this.reconciliationState.items = data.items || [];
        this.reconciliationState.total = data.total || 0;

        if (this.reconciliationState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS['git-compare']}
                  <div class="admin-empty-title">No reconciliation runs found</div>
                  <div class="admin-empty-desc">Trigger a batch reconciliation run to verify payment/refund ledger integrity against Razorpay.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('reconRunPaginationBar', this.reconciliationState, (p) => { this.reconciliationState.page = p; this.loadReconciliationRuns(); });
          return;
        }

        tbody.innerHTML = this.reconciliationState.items.map(run => {
          const windowStart = run.windowStart ? new Date(run.windowStart).toLocaleDateString() : (run.startDate ? new Date(run.startDate).toLocaleDateString() : '—');
          const windowEnd = run.windowEnd ? new Date(run.windowEnd).toLocaleDateString() : (run.endDate ? new Date(run.endDate).toLocaleDateString() : '—');
          const discCount = run.discrepancyCount ?? (run._count ? run._count.discrepancies : 0);
          const discBadge = discCount > 0
            ? `<span class="admin-badge admin-badge-warning">${discCount} Drifts</span>`
            : `<span class="admin-badge admin-badge-success">0 Drifts</span>`;

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);"><code class="admin-code-pill">${this._escape(run.id.substring(0, 10))}...</code></strong>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(run.scope || 'FULL_BILLING')}</div>
              </td>
              <td style="font-size:0.8125rem;">${windowStart} &rarr; ${windowEnd}</td>
              <td style="font-size:0.8125rem;">
                <strong>${run.totalProcessed ?? run.recordsProcessed ?? 0}</strong> processed
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${run.matchedCount ?? 0} exact matches</div>
              </td>
              <td>${discBadge}</td>
              <td style="font-size:0.8125rem;">
                <strong>${run.settlementsMatched ?? 0}</strong> matched
              </td>
              <td>${this._renderStatusBadge(run.status)}</td>
              <td style="font-size:0.8125rem;">
                <div>${this._escape(run.startedBy || 'SYSTEM')}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}</div>
              </td>
              <td style="text-align:right;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectReconciliationRun('${run.id}')" title="Inspect run results & discrepancies">
                  ${ICONS.eye} Inspect
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('reconRunPaginationBar', this.reconciliationState, (p) => { this.reconciliationState.page = p; this.loadReconciliationRuns(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load reconciliation runs')}</td></tr>`;
      }
    }

    async inspectReconciliationRun(runId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/billing/reconciliation/runs/${runId}`);
        const run = res.data;

        const windowStart = run.windowStart ? new Date(run.windowStart).toLocaleString() : (run.startDate ? new Date(run.startDate).toLocaleString() : '—');
        const windowEnd = run.windowEnd ? new Date(run.windowEnd).toLocaleString() : (run.endDate ? new Date(run.endDate).toLocaleString() : '—');
        const durationSec = run.completedAt && run.createdAt ? Math.round((new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()) / 1000) : null;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Reconciliation Run Telemetry</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Run ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(run.id)}</code></span>
              <span class="admin-property-label">Scope:</span>
              <span class="admin-property-value"><strong>${this._escape(run.scope || 'FULL_BILLING')}</strong></span>
              <span class="admin-property-label">Execution Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(run.status)}</span>
              <span class="admin-property-label">Time Window:</span>
              <span class="admin-property-value">${windowStart} &rarr; ${windowEnd}</span>
              <span class="admin-property-label">Records Processed:</span>
              <span class="admin-property-value"><strong>${run.totalProcessed ?? run.recordsProcessed ?? 0}</strong></span>
              <span class="admin-property-label">Matched Cleanly:</span>
              <span class="admin-property-value"><strong style="color:var(--admin-success);">${run.matchedCount ?? 0}</strong></span>
              <span class="admin-property-label">Discrepancies Flagged:</span>
              <span class="admin-property-value"><strong style="color:${(run.discrepancyCount || 0) > 0 ? 'var(--admin-warning)' : 'var(--admin-success)'};">${run.discrepancyCount ?? 0}</strong></span>
              <span class="admin-property-label">Settlements Reconciled:</span>
              <span class="admin-property-value"><strong>${run.settlementsMatched ?? 0}</strong></span>
              <span class="admin-property-label">Execution Duration:</span>
              <span class="admin-property-value">${durationSec !== null ? durationSec + ' seconds' : 'In Progress / N/A'}</span>
              <span class="admin-property-label">Triggered By:</span>
              <span class="admin-property-value">${this._escape(run.startedBy || 'SYSTEM')}</span>
            </div>
          </div>

          ${run.discrepancies && run.discrepancies.length > 0 ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Detected Drift / Discrepancies (${run.discrepancies.length})</div>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${run.discrepancies.map(d => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:0.875rem;font-weight:600;">${this._escape(d.discrepancyType || d.type)} &bull; <span style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(d.id.substring(0, 8))}...</span></div>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">${this._escape(d.details || d.description || 'Drift detected')}</div>
                    </div>
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectDiscrepancy('${d.id}')">
                      ${ICONS.eye} Inspect
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div class="admin-drawer-section">
              <div style="background:var(--admin-success-subtle);border-left:3px solid var(--admin-success);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-size:0.8125rem;color:var(--admin-success);">
                <strong>Audit Result:</strong> Zero discrepancies or financial drift identified for this run window.
              </div>
            </div>
          `}
        `;

        this._showDrawer(`Reconciliation Run: ${run.id.substring(0, 12)}...`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect reconciliation run', 'danger');
      }
    }

    showStartReconciliationModal() {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      // Default start date = 7 days ago, end date = now
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const defaultStart = sevenDaysAgo.toISOString().split('T')[0];
      const defaultEnd = now.toISOString().split('T')[0];

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:540px;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Trigger Administrative Reconciliation Run</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;font-size:0.875rem;">
              Execute batch audit comparing local customer billing ledgers against upstream Razorpay provider settlements and transactions.
            </p>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Reconciliation Scope:
              </label>
              <select id="adminReconScopeSelect" class="admin-select" style="width:100%;">
                <option value="FULL_BILLING">FULL_BILLING (All Payments, Refunds & Settlements)</option>
                <option value="DATE_RANGE">DATE_RANGE (Bounded Time Window)</option>
                <option value="PAYMENTS">PAYMENTS (Payment Transactions Only)</option>
                <option value="REFUNDS">REFUNDS (Refund Transactions Only)</option>
                <option value="SETTLEMENTS">SETTLEMENTS (Provider Settlement Matching)</option>
              </select>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
              <div>
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                  Window Start:
                </label>
                <input type="date" id="adminReconStartDateInput" class="admin-search-input" value="${defaultStart}" style="padding-left:0.875rem;">
              </div>
              <div>
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                  Window End:
                </label>
                <input type="date" id="adminReconEndDateInput" class="admin-search-input" value="${defaultEnd}" style="padding-left:0.875rem;">
              </div>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Administrative Notes / Audit Reason:
              </label>
              <input type="text" id="adminReconNotesInput" class="admin-search-input" maxlength="255" placeholder="e.g. Monthly close reconciliation, audit check..." style="padding-left:0.875rem;">
            </div>

            <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-size:0.8125rem;color:var(--admin-warning);">
              <strong>Notice:</strong> Reconciliation runs query upstream provider APIs and are concurrency-locked. Maximum allowed query window is 90 days.
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="adminModalConfirmStartBtn">Start Reconciliation</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmStartBtn');
      const scopeSelect = document.getElementById('adminReconScopeSelect');
      const startInput = document.getElementById('adminReconStartDateInput');
      const endInput = document.getElementById('adminReconEndDateInput');
      const notesInput = document.getElementById('adminReconNotesInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const scope = scopeSelect.value;
          const startDate = startInput.value ? new Date(startInput.value).toISOString() : undefined;
          const endDate = endInput.value ? new Date(endInput.value + 'T23:59:59.999Z').toISOString() : undefined;
          const reason = notesInput ? notesInput.value.trim() : '';

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Triggering Run...';

          try {
            await window.AdminApi.post('/admin/operations/billing/reconciliation/runs', {
              scope,
              startDate,
              endDate,
              notes: reason || undefined
            });

            this.toast('Reconciliation run started successfully.', 'success');
            closeModal();
            this.loadReconciliationRuns();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Start Reconciliation';
            this.toast(err.message || 'Failed to start reconciliation run', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    async loadDiscrepancies() {
      const tbody = document.getElementById('discrepancyTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading discrepancies...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.discrepancyState.page.toString(),
          pageSize: this.discrepancyState.pageSize.toString()
        });
        if (this.discrepancyState.search) queryParams.set('search', this.discrepancyState.search);
        if (this.discrepancyState.status) queryParams.set('status', this.discrepancyState.status);
        if (this.discrepancyState.discrepancyType) queryParams.set('discrepancyType', this.discrepancyState.discrepancyType);

        const res = await window.AdminApi.get(`/admin/operations/billing/reconciliation/discrepancies?${queryParams.toString()}`);
        const data = res.data;
        this.discrepancyState.items = data.items || [];
        this.discrepancyState.total = data.total || 0;

        if (this.discrepancyState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['git-compare']}
                  <div class="admin-empty-title">No discrepancies found</div>
                  <div class="admin-empty-desc">No local-vs-provider financial drift matches your filter criteria.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('discrepancyPaginationBar', this.discrepancyState, (p) => { this.discrepancyState.page = p; this.loadDiscrepancies(); });
          return;
        }

        tbody.innerHTML = this.discrepancyState.items.map(d => {
          const type = d.discrepancyType || d.type || 'UNKNOWN';
          const severity = d.severity || 'MEDIUM';
          let sevBadge = `<span class="admin-badge admin-badge-neutral">${severity}</span>`;
          if (severity === 'CRITICAL' || severity === 'HIGH') sevBadge = `<span class="admin-badge admin-badge-danger">${severity}</span>`;
          if (severity === 'MEDIUM') sevBadge = `<span class="admin-badge admin-badge-warning">${severity}</span>`;
          if (severity === 'LOW') sevBadge = `<span class="admin-badge admin-badge-info">${severity}</span>`;

          const entityRef = d.paymentId ? `Pay: ${d.paymentId.substring(0, 8)}...` : (d.providerPaymentId ? `Prov: ${d.providerPaymentId.substring(0, 10)}...` : (d.providerSubscriptionId ? `Sub: ${d.providerSubscriptionId.substring(0, 10)}...` : 'N/A'));
          const userEmail = d.payment && d.payment.user ? d.payment.user.email : (d.userEmail || '');

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);">${this._escape(type)}</strong>
                <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(d.id.substring(0, 12))}...</div>
              </td>
              <td>${sevBadge}</td>
              <td style="font-size:0.8125rem;">
                <div>${this._escape(entityRef)}</div>
                ${userEmail ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(userEmail)}</div>` : ''}
              </td>
              <td style="font-size:0.8125rem;max-width:260px;">
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${this._escape(d.details || d.description || '')}">
                  ${this._escape(d.details || d.description || 'Drift detected')}
                </div>
              </td>
              <td>${this._renderStatusBadge(d.status)}</td>
              <td style="font-size:0.8125rem;">
                <div>${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</div>
              </td>
              <td style="text-align:right;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectDiscrepancy('${d.id}')" title="Inspect discrepancy details">
                  ${ICONS.eye} Inspect
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('discrepancyPaginationBar', this.discrepancyState, (p) => { this.discrepancyState.page = p; this.loadDiscrepancies(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load discrepancies')}</td></tr>`;
      }
    }

    async inspectDiscrepancy(discId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/billing/reconciliation/discrepancies/${discId}`);
        const d = res.data;
        const canReconcile = window.AdminAuth.hasPermission('billing.reconcile');

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Discrepancy Inspection</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Discrepancy ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(d.id)}</code></span>
              <span class="admin-property-label">Discrepancy Type:</span>
              <span class="admin-property-value"><strong>${this._escape(d.discrepancyType || d.type)}</strong></span>
              <span class="admin-property-label">Severity Level:</span>
              <span class="admin-property-value"><strong>${this._escape(d.severity || 'MEDIUM')}</strong></span>
              <span class="admin-property-label">Lifecycle Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(d.status)}</span>
              <span class="admin-property-label">Discovered At:</span>
              <span class="admin-property-value">${d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}</span>
              <span class="admin-property-label">Resolved At:</span>
              <span class="admin-property-value">${d.resolvedAt ? new Date(d.resolvedAt).toLocaleString() : 'Open / Unresolved'}</span>
              <span class="admin-property-label">Resolved By:</span>
              <span class="admin-property-value">${this._escape(d.resolvedBy || 'None')}</span>
              <span class="admin-property-label">Resolution Notes:</span>
              <span class="admin-property-value">${this._escape(d.resolutionNotes || d.notes || 'None recorded')}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Drift Comparison</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Local Amount:</span>
              <span class="admin-property-value"><strong>${d.localAmountMinorUnits !== null && d.localAmountMinorUnits !== undefined ? (d.localAmountMinorUnits / 100).toFixed(2) : '—'}</strong></span>
              <span class="admin-property-label">Provider Amount:</span>
              <span class="admin-property-value"><strong>${d.providerAmountMinorUnits !== null && d.providerAmountMinorUnits !== undefined ? (d.providerAmountMinorUnits / 100).toFixed(2) : '—'}</strong></span>
              <span class="admin-property-label">Local Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(d.localStatus)}</span>
              <span class="admin-property-label">Provider Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(d.providerStatus)}</span>
            </div>
            <div style="margin-top:0.75rem;">
              <span style="font-size:0.75rem;font-weight:600;color:var(--admin-text-muted);display:block;margin-bottom:0.25rem;">Drift Details:</span>
              <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);font-size:0.8125rem;">
                ${this._escape(d.details || d.description || 'No additional narrative.')}
              </div>
            </div>
          </div>

          ${d.payment ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Associated Local Payment</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Payment ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(d.payment.id)}</code></span>
                <span class="admin-property-label">Customer Email:</span>
                <span class="admin-property-value"><strong>${this._escape(d.payment.userEmail || (d.payment.user ? d.payment.user.email : 'N/A'))}</strong></span>
                <span class="admin-property-label">Recorded Amount:</span>
                <span class="admin-property-value">${(d.payment.amountMinorUnits / 100).toFixed(2)} ${this._escape(d.payment.currency || 'INR')}</span>
                <span class="admin-property-label">Provider Ref:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(d.payment.providerPaymentId || 'None')}</code></span>
              </div>
            </div>
          ` : ''}

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${canReconcile && d.status !== 'RESOLVED' ? `
              <button class="admin-btn admin-btn-primary" onclick="AdminShell.showResolveDiscrepancyModal('${d.id}')">
                Resolve Discrepancy
              </button>
            ` : ''}
          </div>
        `;

        this._showDrawer(`Discrepancy: ${d.discrepancyType || d.type} (${d.id.substring(0, 10)}...)`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect discrepancy', 'danger');
      }
    }

    showResolveDiscrepancyModal(discrepancyId) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:540px;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Resolve Billing Discrepancy</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;font-size:0.875rem;">
              Select an administrative resolution strategy for discrepancy <code>${this._escape(discrepancyId)}</code>.
            </p>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Resolution Action:
              </label>
              <select id="adminResolveActionSelect" class="admin-select" style="width:100%;">
                <option value="MARK_RESOLVED">MARK_RESOLVED (Acknowledge & Mark Resolved in Audit Chain)</option>
                <option value="ACKNOWLEDGE">ACKNOWLEDGE (Acknowledge Drift Under Investigation)</option>
                <option value="RETRY_PROVIDER_LOOKUP">RETRY_PROVIDER_LOOKUP (Re-query Razorpay Upstream API)</option>
                <option value="SYNC_PROVIDER_REFERENCE">SYNC_PROVIDER_REFERENCE (Update Local Payment Provider Ref)</option>
              </select>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Resolution Notes / Explanation:
              </label>
              <textarea id="adminResolveNotesInput" class="admin-search-input" rows="3" placeholder="Provide justification for resolution (e.g. Razorpay payment ID verified, fee variance accepted...)" style="padding:0.5rem 0.875rem;height:auto;resize:vertical;"></textarea>
            </div>

            <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-size:0.8125rem;color:var(--admin-warning);">
              <strong>Notice:</strong> Resolving a discrepancy creates an immutable, SHA-256 chained entry in the security audit logs.
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="adminModalConfirmResolveBtn">Apply Resolution</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmResolveBtn');
      const actionSelect = document.getElementById('adminResolveActionSelect');
      const notesInput = document.getElementById('adminResolveNotesInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const action = actionSelect.value;
          const notes = notesInput ? notesInput.value.trim() : '';

          if (!notes) {
            this.toast('Resolution notes are required.', 'danger');
            return;
          }

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Applying...';

          try {
            await window.AdminApi.post(`/admin/operations/billing/reconciliation/discrepancies/${discrepancyId}/resolve`, {
              action,
              notes
            });

            this.toast('Discrepancy resolved successfully.', 'success');
            closeModal();
            this._closeDrawer();
            this.loadDiscrepancies();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Apply Resolution';
            this.toast(err.message || 'Failed to resolve discrepancy', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    /* =========================================================================
       6-E. CONSOLIDATED BILLING OVERVIEW & FINANCIAL OPERATIONS
       ========================================================================= */
    async _renderBillingOverviewView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Financial &amp; Billing Overview</h1>
            <p>Consolidated subscription metrics, revenue telemetry, settlement tracking, and real-time reconciliation health.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="billingGlobalSearchModalBtn">
              ${ICONS.search} Global Billing Search
            </button>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshBillingOverviewBtn">
              ${ICONS['refresh-cw']} Refresh Telemetry
            </button>
            <button class="admin-btn admin-btn-primary admin-btn-sm" id="triggerReconFromOverviewBtn">
              ${ICONS.play} Run Reconciliation
            </button>
          </div>
        </div>

        <div class="admin-filter-bar" style="margin-bottom:var(--space-md);">
          <div class="admin-search-wrap" style="flex:1;">
            ${ICONS.search}
            <input type="text" id="billingOverviewQuickSearchInput" class="admin-search-input" placeholder="Quick search transactions, subscriptions, refunds, settlements, or customer emails...">
          </div>
        </div>

        <div id="billingOverviewCards" class="admin-grid-4">
          <div class="admin-card"><div class="admin-stat-label">Active Subscriptions</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Gross Revenue</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Refunds Processed</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Total Settlements</div><div class="admin-stat-value">...</div></div>
        </div>

        <div class="admin-grid-2" style="margin-top:var(--space-xl);">
          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md);">
              <h2 class="admin-card-title" style="margin:0;font-size:1rem;font-weight:700;">Recent Billing &amp; Financial Activity</h2>
              <span class="admin-badge admin-badge-neutral">Live Ledger</span>
            </div>
            <div id="billingRecentActivityContainer">
              <div style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading live activity stream...</div>
            </div>
          </div>

          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md);">
              <h2 class="admin-card-title" style="margin:0;font-size:1rem;font-weight:700;">Reconciliation Health &amp; Provider Drift</h2>
              <span class="admin-badge admin-badge-neutral">Provider Sync</span>
            </div>
            <div id="billingReconHealthContainer">
              <div style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading reconciliation telemetry...</div>
            </div>
          </div>
        </div>
      `;

      const searchBtn = document.getElementById('billingGlobalSearchModalBtn');
      const refreshBtn = document.getElementById('refreshBillingOverviewBtn');
      const triggerBtn = document.getElementById('triggerReconFromOverviewBtn');
      const quickSearchInput = document.getElementById('billingOverviewQuickSearchInput');

      if (searchBtn) searchBtn.addEventListener('click', () => this.showGlobalBillingSearchModal());
      if (refreshBtn) refreshBtn.addEventListener('click', () => this._renderBillingOverviewView(container));
      if (triggerBtn) triggerBtn.addEventListener('click', () => this.showStartReconciliationModal());

      if (quickSearchInput) {
        quickSearchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const query = quickSearchInput.value.trim();
            if (query) {
              this.showGlobalBillingSearchModal(query);
            }
          }
        });
      }

      try {
        const res = await window.AdminApi.get('/admin/operations/billing/overview');
        const data = res.data;

        // Populate Top KPI Cards
        const cardsEl = document.getElementById('billingOverviewCards');
        if (cardsEl) {
          const subs = data.subscriptions || {};
          const pays = data.payments || {};
          const refs = data.refunds || {};
          const setts = data.settlements || {};

          const grossFormatted = `₹${((pays.totalGrossVolumeMinorUnits || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const refundFormatted = `₹${((refs.totalRefundedVolumeMinorUnits || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const settFormatted = `₹${((setts.totalSettledAmountMinorUnits || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

          cardsEl.innerHTML = `
            <div class="admin-card">
              <div class="admin-stat-label">Active Subscriptions</div>
              <div class="admin-stat-value" style="color:var(--admin-primary);">${subs.activeCount || 0}</div>
              <div class="admin-stat-hint">
                <span style="color:var(--admin-warning);">${subs.pastDueCount || 0} past due</span> &bull; <span>${subs.triagedCount || 0} triaged</span>
              </div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label">Gross Collections</div>
              <div class="admin-stat-value" style="color:var(--admin-success);">${grossFormatted}</div>
              <div class="admin-stat-hint">
                <span>${pays.successfulCount || 0} successful</span> &bull; <span style="color:var(--admin-danger);">${pays.failedCount || 0} failed</span>
              </div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label">Refunds Issued</div>
              <div class="admin-stat-value" style="color:var(--admin-warning);">${refundFormatted}</div>
              <div class="admin-stat-hint">
                <span>${refs.processedCount || 0} processed</span> &bull; <span>${refs.pendingCount || 0} pending</span>
              </div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label">Net Settled Payouts</div>
              <div class="admin-stat-value" style="color:var(--admin-text-primary);">${settFormatted}</div>
              <div class="admin-stat-hint">
                <span>${setts.reconciledCount || 0} / ${setts.totalSettlements || 0} reconciled</span>
              </div>
            </div>
          `;
        }

        // Populate Activity Container
        const activityEl = document.getElementById('billingRecentActivityContainer');
        if (activityEl) {
          const events = data.recentActivity || [];
          if (events.length === 0) {
            activityEl.innerHTML = `
              <div class="admin-empty-box" style="padding:1.5rem;">
                <div class="admin-empty-title">No recent billing activity</div>
                <div class="admin-empty-desc">Transactions, refunds, and subscriptions will appear here in real time.</div>
              </div>
            `;
          } else {
            activityEl.innerHTML = `
              <div style="display:flex;flex-direction:column;gap:0.625rem;">
                ${events.map(ev => {
                  let badgeType = 'neutral';
                  let icon = ICONS['dollar-sign'];
                  let inspectAction = '';

                  if (ev.type === 'PAYMENT') {
                    icon = ICONS['dollar-sign'];
                    badgeType = ev.status === 'SUCCESS' ? 'success' : (ev.status === 'FAILED' ? 'danger' : 'warning');
                    inspectAction = `AdminShell.inspectPayment('${ev.id}')`;
                  } else if (ev.type === 'REFUND') {
                    icon = ICONS['rotate-ccw'];
                    badgeType = ev.status === 'PROCESSED' ? 'warning' : 'neutral';
                    inspectAction = `AdminShell.inspectRefund('${ev.id}')`;
                  } else if (ev.type === 'SUBSCRIPTION') {
                    icon = ICONS['credit-card'];
                    badgeType = ev.status === 'ACTIVE' ? 'success' : (ev.status === 'PAST_DUE' ? 'warning' : 'danger');
                    inspectAction = `AdminShell.inspectSubscription('${ev.id}')`;
                  } else if (ev.type === 'SETTLEMENT') {
                    icon = ICONS.database;
                    badgeType = 'neutral';
                    inspectAction = `AdminShell.inspectSettlement('${ev.id}')`;
                  }

                  const amtStr = ev.amountMinorUnits ? `₹${(ev.amountMinorUnits / 100).toFixed(2)} ${ev.currency || 'INR'}` : '';

                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div style="display:flex;align-items:center;gap:0.75rem;">
                        <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-xs);background:var(--admin-bg-subtle);">
                          ${icon}
                        </span>
                        <div>
                          <div style="font-size:0.8125rem;font-weight:600;color:var(--admin-text-primary);">
                            ${this._escape(ev.type)} &bull; <code>${this._escape(ev.id.substring(0, 10))}...</code>
                            ${amtStr ? `<strong style="margin-left:0.5rem;color:var(--admin-text-primary);">${amtStr}</strong>` : ''}
                          </div>
                          <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">
                            ${this._escape(ev.userEmail || ev.title || 'System entity')} &bull; ${ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}
                          </div>
                        </div>
                      </div>
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="admin-badge admin-badge-${badgeType}">${this._escape(ev.status)}</span>
                        ${inspectAction ? `
                          <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="${inspectAction}">
                            ${ICONS.eye}
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }
        }

        // Populate Recon Health Container
        const reconEl = document.getElementById('billingReconHealthContainer');
        if (reconEl) {
          const recon = data.reconciliation || {};
          const latestRun = recon.latestRun;
          const openDiscs = recon.openDiscrepancies || 0;
          const discBreakdown = recon.discrepanciesByType || {};

          reconEl.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:1rem;">
              <div class="admin-property-grid" style="background:var(--admin-bg-base);padding:1rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                <span class="admin-property-label">Last Reconciliation Run:</span>
                <span class="admin-property-value">
                  ${latestRun ? `<strong>${latestRun.status}</strong> (${new Date(latestRun.createdAt).toLocaleString()})` : '<span style="color:var(--admin-text-muted);">No runs recorded yet</span>'}
                </span>
                <span class="admin-property-label">Last Successful Run:</span>
                <span class="admin-property-value">
                  ${recon.lastSuccessfulRun ? new Date(recon.lastSuccessfulRun).toLocaleString() : '<span style="color:var(--admin-text-muted);">Never</span>'}
                </span>
                <span class="admin-property-label">Active Discrepancies:</span>
                <span class="admin-property-value">
                  <strong style="color:${openDiscs > 0 ? 'var(--admin-warning)' : 'var(--admin-success)'};">${openDiscs} Open Drifts</strong>
                </span>
                <span class="admin-property-label">Resolved Discrepancies:</span>
                <span class="admin-property-value">
                  <strong style="color:var(--admin-success);">${recon.resolvedDiscrepancies || 0} Resolved</strong>
                </span>
              </div>

              <div>
                <h3 style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;letter-spacing:0.04em;">
                  Drift Distribution by Type
                </h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:0.5rem;">
                  <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem;text-align:center;">
                    <div style="font-size:0.75rem;color:var(--admin-text-muted);">Amount Drift</div>
                    <div style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin-top:2px;">${discBreakdown.AMOUNT_MISMATCH || 0}</div>
                  </div>
                  <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem;text-align:center;">
                    <div style="font-size:0.75rem;color:var(--admin-text-muted);">Status Drift</div>
                    <div style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin-top:2px;">${discBreakdown.STATUS_MISMATCH || 0}</div>
                  </div>
                  <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem;text-align:center;">
                    <div style="font-size:0.75rem;color:var(--admin-text-muted);">Fee Variance</div>
                    <div style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin-top:2px;">${discBreakdown.FEE_MISMATCH || 0}</div>
                  </div>
                  <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem;text-align:center;">
                    <div style="font-size:0.75rem;color:var(--admin-text-muted);">Missing Upstream</div>
                    <div style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin-top:2px;">${discBreakdown.MISSING_PROVIDER_RECORD || 0}</div>
                  </div>
                </div>
              </div>

              <div style="display:flex;gap:0.75rem;margin-top:0.5rem;flex-wrap:wrap;">
                <a href="#reconciliation" class="admin-btn admin-btn-secondary admin-btn-sm" style="flex:1;text-align:center;justify-content:center;">
                  ${ICONS['git-compare']} Reconciliation Console
                </a>
                <a href="#settlements" class="admin-btn admin-btn-secondary admin-btn-sm" style="flex:1;text-align:center;justify-content:center;">
                  ${ICONS.database} Settlements Ledger
                </a>
              </div>
            </div>
          `;
        }
      } catch (err) {
        this.toast(err.message || 'Failed to load consolidated billing telemetry', 'danger');
      }
    }

    /* =========================================================================
       6-F. SETTLEMENTS & PAYOUTS LEDGER
       ========================================================================= */
    _renderSettlementsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Settlements &amp; Provider Payouts</h1>
            <p>Track Razorpay settlement batches, transaction processing fees, net bank credits, and reconciliation ledger state.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshSettlementsBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
            <a href="#reconciliation" class="admin-btn admin-btn-primary admin-btn-sm">
              ${ICONS['git-compare']} Reconciliation Workspace
            </a>
          </div>
        </div>

        <div class="admin-filter-bar">
          <div class="admin-search-wrap" style="flex:1;">
            ${ICONS.search}
            <input type="text" id="settlementSearchInput" class="admin-search-input" placeholder="Search by Settlement ID, Provider Settlement Reference, or Currency...">
          </div>
          <div class="admin-filter-group">
            <select id="settlementReconStatusSelect" class="admin-select">
              <option value="">All Reconciliation States</option>
              <option value="RECONCILED">RECONCILED</option>
              <option value="DISCREPANCY">DISCREPANCY</option>
              <option value="UNRECONCILED">UNRECONCILED</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Settlement ID / Provider Ref</th>
                  <th>Settled Date</th>
                  <th>Currency</th>
                  <th>Gross Amount</th>
                  <th>Fee &amp; Tax</th>
                  <th>Net Bank Credit</th>
                  <th>Reconciliation State</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="settlementTableBody">
                <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading settlements ledger...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="settlementPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const refreshBtn = document.getElementById('refreshSettlementsBtn');
      const searchInput = document.getElementById('settlementSearchInput');
      const statusSelect = document.getElementById('settlementReconStatusSelect');

      if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadSettlements());

      let debounce = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            this.settlementState.search = e.target.value.trim();
            this.settlementState.page = 1;
            this.loadSettlements();
          }, 300);
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.settlementState.reconciliationStatus = e.target.value;
          this.settlementState.page = 1;
          this.loadSettlements();
        });
      }

      this.loadSettlements();
    }

    async loadSettlements() {
      const tbody = document.getElementById('settlementTableBody');
      if (!tbody) return;

      try {
        const queryParams = new URLSearchParams({
          page: String(this.settlementState.page),
          pageSize: String(this.settlementState.pageSize)
        });
        if (this.settlementState.search) queryParams.set('search', this.settlementState.search);
        if (this.settlementState.reconciliationStatus) queryParams.set('reconciliationStatus', this.settlementState.reconciliationStatus);

        const res = await window.AdminApi.get(`/admin/operations/billing/settlements?${queryParams.toString()}`);
        const data = res.data;
        this.settlementState.items = data.items || [];
        this.settlementState.total = data.total || 0;

        if (this.settlementState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS.database}
                  <div class="admin-empty-title">No settlements recorded</div>
                  <div class="admin-empty-desc">Bank settlement batches will appear here once Razorpay processes payout cycles.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('settlementPaginationBar', this.settlementState, (p) => { this.settlementState.page = p; this.loadSettlements(); });
          return;
        }

        tbody.innerHTML = this.settlementState.items.map(s => {
          const grossFormatted = `₹${((s.grossAmountMinorUnits || 0) / 100).toFixed(2)}`;
          const feeTaxMinor = (s.feeAmountMinorUnits || 0) + (s.taxAmountMinorUnits || 0);
          const feeTaxFormatted = `₹${(feeTaxMinor / 100).toFixed(2)}`;
          const netFormatted = `₹${((s.netAmountMinorUnits || 0) / 100).toFixed(2)}`;
          const settledDate = s.settledAt ? new Date(s.settledAt).toLocaleDateString() : (s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—');

          let reconBadge = `<span class="admin-badge admin-badge-neutral">${this._escape(s.reconciliationStatus || 'UNRECONCILED')}</span>`;
          if (s.reconciliationStatus === 'RECONCILED') {
            reconBadge = `<span class="admin-badge admin-badge-success">${ICONS.check} RECONCILED</span>`;
          } else if (s.reconciliationStatus === 'DISCREPANCY') {
            reconBadge = `<span class="admin-badge admin-badge-warning">DISCREPANCY</span>`;
          }

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);"><code class="admin-code-pill">${this._escape(s.id.substring(0, 10))}...</code></strong>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);font-family:var(--font-mono);">${this._escape(s.providerSettlementId || 'N/A')}</div>
              </td>
              <td style="font-size:0.8125rem;">${settledDate}</td>
              <td><span class="admin-badge admin-badge-neutral">${this._escape(s.currency)}</span></td>
              <td style="font-size:0.8125rem;"><strong>${grossFormatted}</strong></td>
              <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${feeTaxFormatted}</td>
              <td style="font-size:0.8125rem;"><strong style="color:var(--admin-success);">${netFormatted}</strong></td>
              <td>${reconBadge}</td>
              <td style="text-align:right;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectSettlement('${s.id}')" title="Inspect settlement details & linked transactions">
                  ${ICONS.eye} Inspect
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('settlementPaginationBar', this.settlementState, (p) => { this.settlementState.page = p; this.loadSettlements(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load settlements')}</td></tr>`;
      }
    }

    async inspectSettlement(settlementId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/billing/settlements/${settlementId}`);
        const s = res.data;

        const grossFormatted = `₹${((s.grossAmountMinorUnits || 0) / 100).toFixed(2)} ${s.currency}`;
        const feeFormatted = `₹${((s.feeAmountMinorUnits || 0) / 100).toFixed(2)} ${s.currency}`;
        const taxFormatted = `₹${((s.taxAmountMinorUnits || 0) / 100).toFixed(2)} ${s.currency}`;
        const netFormatted = `₹${((s.netAmountMinorUnits || 0) / 100).toFixed(2)} ${s.currency}`;
        const settledDate = s.settledAt ? new Date(s.settledAt).toLocaleString() : 'Pending Payout';

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Settlement Batch Telemetry</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Settlement ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(s.id)}</code></span>
              <span class="admin-property-label">Provider Ref:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(s.providerSettlementId || 'N/A')}</code></span>
              <span class="admin-property-label">Settled Timestamp:</span>
              <span class="admin-property-value">${settledDate}</span>
              <span class="admin-property-label">Reconciliation State:</span>
              <span class="admin-property-value">${this._escape(s.reconciliationStatus || 'UNRECONCILED')}</span>
              <span class="admin-property-label">Currency:</span>
              <span class="admin-property-value"><strong>${this._escape(s.currency)}</strong></span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Financial Breakdown</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Gross Batch Total:</span>
              <span class="admin-property-value"><strong>${grossFormatted}</strong></span>
              <span class="admin-property-label">Provider Fee:</span>
              <span class="admin-property-value">${feeFormatted}</span>
              <span class="admin-property-label">Goods &amp; Services Tax:</span>
              <span class="admin-property-value">${taxFormatted}</span>
              <span class="admin-property-label">Net Bank Payout:</span>
              <span class="admin-property-value"><strong style="color:var(--admin-success);">${netFormatted}</strong></span>
            </div>
          </div>

          ${s.reconciliationRecord ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Linked Reconciliation Run</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Recon Run ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(s.reconciliationRecord.id)}</code></span>
                <span class="admin-property-label">Run Status:</span>
                <span class="admin-property-value">${this._renderStatusBadge(s.reconciliationRecord.status)}</span>
                <span class="admin-property-label">Processed At:</span>
                <span class="admin-property-value">${s.reconciliationRecord.createdAt ? new Date(s.reconciliationRecord.createdAt).toLocaleString() : '—'}</span>
              </div>
              <div style="margin-top:0.75rem;">
                <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectReconciliationRun('${s.reconciliationRecord.id}')">
                  ${ICONS.eye} View Reconciliation Run
                </button>
              </div>
            </div>
          ` : ''}

          ${s.payments && s.payments.length > 0 ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Settled Payment Transactions (${s.payments.length})</div>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${s.payments.map(p => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(p.id.substring(0, 10))}...</code> &bull; ₹${((p.amountMinorUnits || 0) / 100).toFixed(2)}</div>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">${this._escape(p.userEmail || p.userId)}</div>
                    </div>
                    <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectPayment('${p.id}')">
                      ${ICONS.eye} Inspect
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${s.refunds && s.refunds.length > 0 ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Settled Refund Deductions (${s.refunds.length})</div>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${s.refunds.map(r => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(r.id.substring(0, 10))}...</code> &bull; -₹${((r.amountMinorUnits || 0) / 100).toFixed(2)}</div>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">Reason: ${this._escape(r.reason || 'Refund')}</div>
                    </div>
                    <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectRefund('${r.id}')">
                      ${ICONS.eye} Inspect
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        `;

        this._showDrawer(`Settlement Batch: ${s.id.substring(0, 12)}...`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect settlement', 'danger');
      }
    }

    /* =========================================================================
       6-G. GLOBAL BILLING SEARCH MODAL & WORKSPACE
       ========================================================================= */
    showGlobalBillingSearchModal(initialQuery = '') {
      const existing = document.getElementById('adminGlobalSearchModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminGlobalSearchModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:760px;width:95%;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">${ICONS.search} Global Billing &amp; Financial Search</h3>
            <button class="admin-btn-icon" id="adminSearchModalCloseBtn" aria-label="Close search">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <div class="admin-search-wrap" style="margin-bottom:1rem;">
              ${ICONS.search}
              <input type="text" id="adminGlobalSearchDialogInput" class="admin-search-input" value="${this._escape(initialQuery)}" placeholder="Search across payments, refunds, subscriptions, settlements, and customers..." autofocus>
            </div>
            <div id="adminGlobalSearchResults" style="max-height:450px;overflow-y:auto;">
              <div style="text-align:center;padding:2rem;color:var(--admin-text-muted);">
                Type at least 2 characters to search across all commercial sub-ledgers.
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminSearchModalCloseBtn');
      const searchInput = document.getElementById('adminGlobalSearchDialogInput');
      const resultsContainer = document.getElementById('adminGlobalSearchResults');

      const closeModal = () => backdrop.remove();
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });

      let debounce = null;
      const executeSearch = async (query) => {
        if (!query || query.length < 2) {
          resultsContainer.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--admin-text-muted);">
              Type at least 2 characters to search across all commercial sub-ledgers.
            </div>
          `;
          return;
        }

        resultsContainer.innerHTML = `
          <div style="text-align:center;padding:2rem;color:var(--admin-text-muted);">
            Searching billing records for <strong>"${this._escape(query)}"</strong>...
          </div>
        `;

        try {
          const res = await window.AdminApi.get(`/admin/operations/billing/search?q=${encodeURIComponent(query)}`);
          const data = res.data;

          const totalHits = (data.payments?.length || 0) + (data.refunds?.length || 0) + (data.subscriptions?.length || 0) + (data.settlements?.length || 0) + (data.users?.length || 0);

          if (totalHits === 0) {
            resultsContainer.innerHTML = `
              <div class="admin-empty-box" style="padding:2rem;">
                ${ICONS.search}
                <div class="admin-empty-title">No billing entities found</div>
                <div class="admin-empty-desc">No payments, refunds, subscriptions, or settlements matched "${this._escape(query)}".</div>
              </div>
            `;
            return;
          }

          let html = `<div style="display:flex;flex-direction:column;gap:1.25rem;">`;

          // Payments Section
          if (data.payments && data.payments.length > 0) {
            html += `
              <div>
                <div style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;">
                  Payments (${data.payments.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${data.payments.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0.875rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div>
                        <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(p.id)}</code> &bull; ₹${((p.amountMinorUnits || 0) / 100).toFixed(2)} ${this._escape(p.currency)}</div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(p.userEmail || p.userId)} &bull; ${this._escape(p.providerPaymentId || 'No Provider Ref')}</div>
                      </div>
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="admin-badge admin-badge-${p.status === 'SUCCESS' ? 'success' : 'neutral'}">${this._escape(p.status)}</span>
                        <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectPayment('${p.id}'); document.getElementById('adminGlobalSearchModalBackdrop')?.remove();">
                          ${ICONS.eye} Inspect
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          // Refunds Section
          if (data.refunds && data.refunds.length > 0) {
            html += `
              <div>
                <div style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;">
                  Refunds (${data.refunds.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${data.refunds.map(r => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0.875rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div>
                        <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(r.id)}</code> &bull; ₹${((r.amountMinorUnits || 0) / 100).toFixed(2)} ${this._escape(r.currency)}</div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(r.providerRefundId || 'No Provider Ref')} &bull; Reason: ${this._escape(r.reason || 'None')}</div>
                      </div>
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="admin-badge admin-badge-warning">${this._escape(r.status)}</span>
                        <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectRefund('${r.id}'); document.getElementById('adminGlobalSearchModalBackdrop')?.remove();">
                          ${ICONS.eye} Inspect
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          // Subscriptions Section
          if (data.subscriptions && data.subscriptions.length > 0) {
            html += `
              <div>
                <div style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;">
                  Subscriptions (${data.subscriptions.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${data.subscriptions.map(s => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0.875rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div>
                        <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(s.id)}</code> &bull; Tier: <strong>${this._escape(s.planCode)}</strong></div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(s.userEmail || s.userId)} &bull; ${this._escape(s.providerSubscriptionId || 'No Provider Ref')}</div>
                      </div>
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="admin-badge admin-badge-${s.status === 'ACTIVE' ? 'success' : 'neutral'}">${this._escape(s.status)}</span>
                        <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectSubscription('${s.id}'); document.getElementById('adminGlobalSearchModalBackdrop')?.remove();">
                          ${ICONS.eye} Inspect
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          // Settlements Section
          if (data.settlements && data.settlements.length > 0) {
            html += `
              <div>
                <div style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;">
                  Settlements (${data.settlements.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${data.settlements.map(st => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0.875rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div>
                        <div style="font-size:0.8125rem;font-weight:600;"><code>${this._escape(st.id)}</code> &bull; Net: ₹${((st.netAmountMinorUnits || 0) / 100).toFixed(2)} ${this._escape(st.currency)}</div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);">Ref: ${this._escape(st.providerSettlementId || 'N/A')} &bull; Status: ${this._escape(st.reconciliationStatus || 'UNRECONCILED')}</div>
                      </div>
                      <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectSettlement('${st.id}'); document.getElementById('adminGlobalSearchModalBackdrop')?.remove();">
                        ${ICONS.eye} Inspect
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          // Customers Section
          if (data.users && data.users.length > 0) {
            html += `
              <div>
                <div style="font-size:0.8125rem;font-weight:700;text-transform:uppercase;color:var(--admin-text-muted);margin-bottom:0.5rem;">
                  Customer Accounts (${data.users.length})
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${data.users.map(u => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0.875rem;background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                      <div>
                        <div style="font-size:0.8125rem;font-weight:600;">${this._escape(u.email)}</div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);">ID: <code>${this._escape(u.id)}</code> &bull; Role: ${this._escape(u.role || 'USER')}</div>
                      </div>
                      <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectUser('${u.id}'); document.getElementById('adminGlobalSearchModalBackdrop')?.remove();">
                        ${ICONS.eye} Inspect Customer
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          html += `</div>`;
          resultsContainer.innerHTML = html;
        } catch (err) {
          resultsContainer.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--admin-danger);">
              ${this._escape(err.message || 'Search execution failed')}
            </div>
          `;
        }
      };

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            executeSearch(e.target.value.trim());
          }, 300);
        });

        if (initialQuery) {
          executeSearch(initialQuery);
        }
      }
    }

    /* =========================================================================
       8. CUSTOMER SUPPORT & HELP DESK (PHASE 10)
       ========================================================================= */
    _renderSupportView(container) {
      const canWrite = window.AdminAuth.hasPermission('support.write');

      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Customer Support &amp; Help Desk</h1>
            <p>Triage customer support cases, inspect bounded customer diagnostics, and manage resolution lifecycles.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshSupportBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
            ${canWrite ? `
              <button class="admin-btn admin-btn-primary admin-btn-sm" id="createSupportCaseBtn">
                + New Support Ticket
              </button>
            ` : ''}
          </div>
        </div>

        <div class="admin-tab-bar" style="display:flex;gap:0.5rem;margin-bottom:1.25rem;">
          <button class="admin-btn ${this.supportActiveTab === 'cases' ? 'admin-btn-primary' : 'admin-btn-secondary'} admin-btn-sm" id="supportTabCasesBtn">
            ${ICONS['life-buoy']} Support Cases &amp; Desk
          </button>
          <button class="admin-btn ${this.supportActiveTab === 'customers' ? 'admin-btn-primary' : 'admin-btn-secondary'} admin-btn-sm" id="supportTabCustomersBtn">
            ${ICONS.users} Customer Lookup &amp; Diagnostics
          </button>
        </div>

        <!-- Cases Tab Content -->
        <div id="supportCasesTabContent" style="display:${this.supportActiveTab === 'cases' ? 'block' : 'none'};">
          <div id="supportMetricsCards" class="admin-grid-4" style="margin-bottom:1.5rem;">
            <div class="admin-card"><div class="admin-stat-label">Total Cases</div><div class="admin-stat-value" id="supStatTotal">...</div></div>
            <div class="admin-card"><div class="admin-stat-label">Open / In Progress</div><div class="admin-stat-value" id="supStatActive" style="color:var(--admin-warning);">...</div></div>
            <div class="admin-card"><div class="admin-stat-label">Resolved / Closed</div><div class="admin-stat-value" id="supStatResolved" style="color:var(--admin-success);">...</div></div>
            <div class="admin-card"><div class="admin-stat-label">Urgent / High Priority</div><div class="admin-stat-value" id="supStatUrgent" style="color:var(--admin-danger);">...</div></div>
          </div>

          <div class="admin-filter-bar" style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center;">
            <div style="position:relative;flex:1;min-width:240px;">
              <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--admin-text-muted);">${ICONS.search}</span>
              <input type="text" id="supportSearchInput" class="admin-search-input" placeholder="Search by case #, subject, or customer email..." style="padding-left:2.25rem;width:100%;">
            </div>
            <select id="supportStatusFilter" class="admin-select" style="min-width:140px;">
              <option value="">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="WAITING_ON_CUSTOMER">Waiting on Customer</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
            <select id="supportPriorityFilter" class="admin-select" style="min-width:130px;">
              <option value="">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
            <select id="supportCategoryFilter" class="admin-select" style="min-width:140px;">
              <option value="">All Categories</option>
              <option value="ACCOUNT">Account</option>
              <option value="DEVICE">Device</option>
              <option value="SERVER">Server</option>
              <option value="FILE_ACCESS">File Access</option>
              <option value="BILLING">Billing</option>
              <option value="CONNECTION">Connection</option>
              <option value="SECURITY">Security</option>
              <option value="GENERAL">General</option>
            </select>
            <select id="supportAttentionFilter" class="admin-select" style="min-width:160px;">
              <option value="">All Attention States</option>
              <option value="attention">Needs Attention</option>
              <option value="unassigned">Unassigned Only</option>
            </select>
            <select id="supportSortFilter" class="admin-select" style="min-width:160px;">
              <option value="createdAt:desc">Newest First</option>
              <option value="createdAt:asc">Oldest First</option>
              <option value="updatedAt:desc">Recently Updated</option>
              <option value="priority:desc">Priority (High-Low)</option>
              <option value="status:asc">Status</option>
            </select>
          </div>

          <div class="admin-card" style="padding:0;overflow:hidden;">
            <div class="admin-table-container">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Customer</th>
                    <th>Subject &amp; Category</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned Agent</th>
                    <th>Notes</th>
                    <th>Created</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="supportTableBody">
                  <tr><td colspan="9" style="text-align:center;padding:2rem;">Loading support cases...</td></tr>
                </tbody>
              </table>
            </div>
            <div class="admin-pagination-bar" id="supportPagination" style="padding:0.75rem 1rem;border-top:1px solid var(--admin-border);display:flex;justify-content:space-between;align-items:center;"></div>
          </div>
        </div>

        <!-- Customer Lookup Tab Content -->
        <div id="supportCustomersTabContent" style="display:${this.supportActiveTab === 'customers' ? 'block' : 'none'};">
          <div class="admin-filter-bar" style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center;">
            <div style="position:relative;flex:1;min-width:280px;">
              <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--admin-text-muted);">${ICONS.search}</span>
              <input type="text" id="supportCustomerSearchInput" class="admin-search-input" placeholder="Search customers by email, full name, or user ID..." style="padding-left:2.25rem;width:100%;">
            </div>
            <select id="supportCustomerStatusSelect" class="admin-select" style="min-width:160px;">
              <option value="">All Account Statuses</option>
              <option value="ACTIVE">Active Accounts</option>
              <option value="SUSPENDED">Suspended Accounts</option>
              <option value="DELETED">Deleted Accounts</option>
            </select>
          </div>

          <div class="admin-card" style="padding:0;overflow:hidden;">
            <div class="admin-table-container">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Customer Identity</th>
                    <th>Account Status</th>
                    <th>Registered Hardware</th>
                    <th>Storage Projection</th>
                    <th>Active Plan</th>
                    <th>Joined</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="supportCustomerTableBody">
                  <tr><td colspan="8" style="text-align:center;padding:2rem;">Loading customer diagnostic directories...</td></tr>
                </tbody>
              </table>
            </div>
            <div class="admin-pagination-bar" id="supportCustomerPagination" style="padding:0.75rem 1rem;border-top:1px solid var(--admin-border);display:flex;justify-content:space-between;align-items:center;"></div>
          </div>
        </div>
      `;

      const refreshBtn = document.getElementById('refreshSupportBtn');
      const createBtn = document.getElementById('createSupportCaseBtn');
      const tabCasesBtn = document.getElementById('supportTabCasesBtn');
      const tabCustomersBtn = document.getElementById('supportTabCustomersBtn');
      const casesContent = document.getElementById('supportCasesTabContent');
      const customersContent = document.getElementById('supportCustomersTabContent');

      if (tabCasesBtn && tabCustomersBtn) {
        tabCasesBtn.addEventListener('click', () => {
          this.supportActiveTab = 'cases';
          tabCasesBtn.className = 'admin-btn admin-btn-primary admin-btn-sm';
          tabCustomersBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
          if (casesContent) casesContent.style.display = 'block';
          if (customersContent) customersContent.style.display = 'none';
          this.loadSupportCases(1);
        });

        tabCustomersBtn.addEventListener('click', () => {
          this.supportActiveTab = 'customers';
          tabCustomersBtn.className = 'admin-btn admin-btn-primary admin-btn-sm';
          tabCasesBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
          if (casesContent) casesContent.style.display = 'none';
          if (customersContent) customersContent.style.display = 'block';
          this.loadSupportCustomers(1);
        });
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          if (this.supportActiveTab === 'cases') {
            this.loadSupportCases(this.supportState.page);
          } else {
            this.loadSupportCustomers(this.supportCustomerState.page);
          }
        });
      }

      if (createBtn) createBtn.addEventListener('click', () => this.showCreateSupportCaseModal());

      const searchInput = document.getElementById('supportSearchInput');
      const statusFilter = document.getElementById('supportStatusFilter');
      const priorityFilter = document.getElementById('supportPriorityFilter');
      const categoryFilter = document.getElementById('supportCategoryFilter');
      const attentionFilter = document.getElementById('supportAttentionFilter');
      const sortFilter = document.getElementById('supportSortFilter');

      let debounceTimer;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.supportState.search = e.target.value.trim();
            this.loadSupportCases(1);
          }, 300);
        });
      }

      if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
          this.supportState.status = e.target.value;
          this.loadSupportCases(1);
        });
      }

      if (priorityFilter) {
        priorityFilter.addEventListener('change', (e) => {
          this.supportState.priority = e.target.value;
          this.loadSupportCases(1);
        });
      }

      if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
          this.supportState.category = e.target.value;
          this.loadSupportCases(1);
        });
      }

      if (attentionFilter) {
        attentionFilter.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val === 'attention') {
            this.supportState.needsAttention = true;
            this.supportState.unassigned = false;
          } else if (val === 'unassigned') {
            this.supportState.unassigned = true;
            this.supportState.needsAttention = false;
          } else {
            this.supportState.needsAttention = false;
            this.supportState.unassigned = false;
          }
          this.loadSupportCases(1);
        });
      }

      if (sortFilter) {
        sortFilter.addEventListener('change', (e) => {
          const parts = e.target.value.split(':');
          this.supportState.sortBy = parts[0] || 'createdAt';
          this.supportState.sortOrder = parts[1] || 'desc';
          this.loadSupportCases(1);
        });
      }

      const custSearchInput = document.getElementById('supportCustomerSearchInput');
      const custStatusSelect = document.getElementById('supportCustomerStatusSelect');

      let custDebounce;
      if (custSearchInput) {
        custSearchInput.addEventListener('input', (e) => {
          clearTimeout(custDebounce);
          custDebounce = setTimeout(() => {
            this.supportCustomerState.search = e.target.value.trim();
            this.loadSupportCustomers(1);
          }, 300);
        });
      }

      if (custStatusSelect) {
        custStatusSelect.addEventListener('change', (e) => {
          this.supportCustomerState.status = e.target.value;
          this.loadSupportCustomers(1);
        });
      }

      if (this.supportActiveTab === 'cases') {
        this.loadSupportCases(1);
      } else {
        this.loadSupportCustomers(1);
      }
    }

    async loadSupportCases(page = 1) {
      this.supportState.page = page;
      const tbody = document.getElementById('supportTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;">Loading support cases...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: String(page),
          pageSize: String(this.supportState.pageSize)
        });

        if (this.supportState.search) queryParams.set('search', this.supportState.search);
        if (this.supportState.status) queryParams.set('status', this.supportState.status);
        if (this.supportState.priority) queryParams.set('priority', this.supportState.priority);
        if (this.supportState.category) queryParams.set('category', this.supportState.category);
        if (this.supportState.assignedAdminId) queryParams.set('assignedAdminId', this.supportState.assignedAdminId);
        if (this.supportState.unassigned) queryParams.set('unassigned', 'true');
        if (this.supportState.needsAttention) queryParams.set('needsAttention', 'true');
        if (this.supportState.sortBy) queryParams.set('sortBy', this.supportState.sortBy);
        if (this.supportState.sortOrder) queryParams.set('sortOrder', this.supportState.sortOrder);

        const [casesRes, overviewRes] = await Promise.all([
          window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases?${queryParams.toString()}`),
          page === 1 ? window.AdminAuth.fetchWithAuth('/api/v1/admin/operations/support/overview') : Promise.resolve(null)
        ]);

        if (overviewRes && overviewRes.success && overviewRes.data) {
          const ov = overviewRes.data;
          const totalEl = document.getElementById('supStatTotal');
          const activeEl = document.getElementById('supStatActive');
          const resolvedEl = document.getElementById('supStatResolved');
          const urgentEl = document.getElementById('supStatUrgent');

          if (totalEl) totalEl.textContent = ov.totalCases.toLocaleString();
          if (activeEl) activeEl.textContent = `${ov.openCases + ov.inProgressCases} (${ov.unassignedCases} unassigned)`;
          if (resolvedEl) resolvedEl.textContent = (ov.resolvedCases + ov.closedCases).toLocaleString();
          if (urgentEl) urgentEl.textContent = (ov.urgentCases + ov.highPriorityCases).toLocaleString();
        }

        if (!casesRes.success) {
          throw new Error(casesRes.error?.message || 'Failed to load support cases');
        }

        const data = casesRes.data;
        this.supportState.items = data.items || [];
        this.supportState.total = data.total || 0;

        if (this.supportState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No support cases found matching criteria.</td></tr>`;
          this._renderPagination('supportPagination', this.supportState, (p) => this.loadSupportCases(p));
          return;
        }

        tbody.innerHTML = this.supportState.items.map(item => {
          let priorityClass = 'neutral';
          if (item.priority === 'URGENT') priorityClass = 'danger';
          else if (item.priority === 'HIGH') priorityClass = 'warning';

          let statusClass = 'neutral';
          if (item.status === 'OPEN' || item.status === 'WAITING_ON_CUSTOMER') statusClass = 'warning';
          else if (item.status === 'IN_PROGRESS') statusClass = 'primary';
          else if (item.status === 'RESOLVED') statusClass = 'success';

          const attentionBadges = [];
          if (item.isUrgent) {
            attentionBadges.push(`<span class="admin-badge admin-badge-danger" style="font-size:0.625rem;padding:1px 4px;" title="Urgent Priority Case">URGENT</span>`);
          }
          if (item.isOverdue) {
            attentionBadges.push(`<span class="admin-badge admin-badge-danger" style="font-size:0.625rem;padding:1px 4px;" title="Overdue: Active with no updates in >24h">OVERDUE</span>`);
          }
          if (item.needsAttention && !item.isUrgent && !item.isOverdue) {
            attentionBadges.push(`<span class="admin-badge admin-badge-warning" style="font-size:0.625rem;padding:1px 4px;" title="Needs Attention">ATTENTION</span>`);
          }

          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-family:monospace;font-weight:700;color:var(--admin-primary);cursor:pointer;" onclick="AdminShell.inspectSupportCase('${item.id}')">
                    ${this._escape(item.caseNumber)}
                  </span>
                  ${attentionBadges.join(' ')}
                </div>
              </td>
              <td>
                <div style="font-weight:600;font-size:0.8125rem;">${this._escape(item.userEmail)}</div>
                ${item.userFullName ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(item.userFullName)}</div>` : ''}
              </td>
              <td>
                <div style="font-weight:600;font-size:0.8125rem;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${this._escape(item.subject)}
                </div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">
                  Category: <strong>${this._escape(item.category)}</strong>
                </div>
              </td>
              <td>
                <span class="admin-badge admin-badge-${priorityClass}">${this._escape(item.priority)}</span>
              </td>
              <td>
                <span class="admin-badge admin-badge-${statusClass}">${this._escape(item.status)}</span>
              </td>
              <td>
                ${item.assignedAdminName ? `
                  <span style="font-size:0.8125rem;font-weight:600;">${this._escape(item.assignedAdminName)}</span>
                ` : `<span class="admin-badge admin-badge-warning" style="font-size:0.6875rem;">Unassigned</span>`}
              </td>
              <td>
                <span class="admin-badge admin-badge-neutral">${item.noteCount}</span>
              </td>
              <td style="font-size:0.75rem;color:var(--admin-text-secondary);white-space:nowrap;">
                ${new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td style="text-align:right;">
                <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectSupportCase('${item.id}')">
                  ${ICONS.eye} Inspect
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('supportPagination', this.supportState, (p) => this.loadSupportCases(p));
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message)}</td></tr>`;
      }
    }

    async loadSupportCustomers(page = 1) {
      this.supportCustomerState.page = page;
      const tbody = document.getElementById('supportCustomerTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;">Loading customer diagnostic directories...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: String(page),
          pageSize: String(this.supportCustomerState.pageSize)
        });

        if (this.supportCustomerState.search) queryParams.set('search', this.supportCustomerState.search);
        if (this.supportCustomerState.status) queryParams.set('status', this.supportCustomerState.status);

        const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/customers?${queryParams.toString()}`);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to load support customer directory');
        }

        const data = res.data;
        this.supportCustomerState.items = data.items || [];
        this.supportCustomerState.total = data.total || 0;

        if (this.supportCustomerState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No customers match your lookup query.</td></tr>`;
          this._renderPagination('supportCustomerPagination', this.supportCustomerState, (p) => this.loadSupportCustomers(p));
          return;
        }

        const formatBytes = (bytes) => {
          if (!bytes || bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        tbody.innerHTML = this.supportCustomerState.items.map(c => {
          let statusClass = 'neutral';
          if (c.status === 'ACTIVE') statusClass = 'success';
          else if (c.status === 'SUSPENDED') statusClass = 'danger';

          const usedStr = formatBytes(c.storageUsed);
          const limitStr = formatBytes(c.storageLimit);

          return `
            <tr>
              <td>
                <span style="font-family:monospace;font-size:0.8125rem;font-weight:700;color:var(--admin-primary);cursor:pointer;" onclick="AdminShell.inspectSupportCustomerContext('${c.id}')">
                  ${this._escape(c.id.length > 12 ? c.id.substring(0, 10) + '...' : c.id)}
                </span>
              </td>
              <td>
                <div style="font-weight:600;font-size:0.8125rem;">${this._escape(c.email)}</div>
                ${c.fullName ? `<div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(c.fullName)}</div>` : ''}
              </td>
              <td>
                <span class="admin-badge admin-badge-${statusClass}">${this._escape(c.status)}</span>
                ${c.emailVerified ? `<span style="color:var(--admin-success);font-size:0.75rem;margin-left:4px;" title="Email Verified">&check;</span>` : ''}
              </td>
              <td style="font-size:0.8125rem;">
                <strong>${c.deviceCount}</strong> devices &bull; <strong>${c.serverCount}</strong> daemons
              </td>
              <td style="font-size:0.8125rem;">
                <span>${usedStr}</span> <span style="font-size:0.75rem;color:var(--admin-text-muted);">/ ${limitStr}</span>
              </td>
              <td>
                <span class="admin-badge admin-badge-neutral">${this._escape(c.activePlan || 'FREE')}</span>
              </td>
              <td style="font-size:0.75rem;color:var(--admin-text-secondary);white-space:nowrap;">
                ${new Date(c.createdAt).toLocaleDateString()}
              </td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:0.375rem;">
                  <button class="admin-btn admin-btn-primary admin-btn-xs" onclick="AdminShell.inspectSupportCustomerContext('${c.id}')" title="Inspect Full Diagnostic Context">
                    ${ICONS.search} Diagnostics
                  </button>
                  <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.showCreateSupportCaseModal('${c.id}')" title="Create Support Ticket">
                    + Ticket
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('supportCustomerPagination', this.supportCustomerState, (p) => this.loadSupportCustomers(p));
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message)}</td></tr>`;
      }
    }

    async inspectSupportCustomerContext(userId) {
      this._showDrawer('Customer Operational Diagnostics', `<div style="padding:2rem;text-align:center;">Aggregating bounded diagnostic projections...</div>`);

      try {
        const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/customers/${userId}/context`);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to aggregate customer diagnostics');
        }

        const data = res.data;
        const u = data.user;
        const devices = data.devices || [];
        const servers = data.servers || [];
        const billing = data.billing;
        const casesSummary = data.supportCases;
        const recentCases = casesSummary?.recentCases || [];

        const formatBytes = (bytes) => {
          if (!bytes || bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <!-- Customer Identity Card -->
            <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
                <div>
                  <div style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);">${this._escape(u.fullName || u.email)}</div>
                  <div style="font-size:0.8125rem;color:var(--admin-text-muted);">${this._escape(u.email)} &bull; User ID: <code style="font-family:monospace;font-size:0.75rem;">${this._escape(u.id)}</code></div>
                </div>
                <div style="display:flex;gap:0.375rem;">
                  <span class="admin-badge admin-badge-${u.status === 'ACTIVE' ? 'success' : 'danger'}">${this._escape(u.status)}</span>
                  ${u.emailVerified ? `<span class="admin-badge admin-badge-success">Verified</span>` : `<span class="admin-badge admin-badge-warning">Unverified</span>`}
                </div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:0.75rem;font-size:0.8125rem;background:var(--admin-bg-base);padding:0.75rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);">
                <div><strong>Registered:</strong> ${new Date(u.createdAt).toLocaleDateString()}</div>
                <div><strong>Last Updated:</strong> ${new Date(u.updatedAt).toLocaleDateString()}</div>
                <div><strong>Storage Used:</strong> ${formatBytes(u.storageUsed)}</div>
                <div><strong>Storage Quota:</strong> ${formatBytes(u.storageLimit)}</div>
              </div>

              <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectUser('${u.id}')">
                  ${ICONS.eye} Core Account Inspector
                </button>
                <button class="admin-btn admin-btn-primary admin-btn-xs" onclick="AdminShell.showCreateSupportCaseModal('${u.id}')">
                  + Create Ticket For Customer
                </button>
              </div>
            </div>

            <!-- Edge Hardware Devices -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <div style="font-size:0.875rem;font-weight:700;color:var(--admin-text-primary);">
                  ${ICONS['hard-drive']} Registered Edge Hardware (${devices.length})
                </div>
              </div>
              ${devices.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${devices.map(d => `
                    <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-size:0.8125rem;">
                      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;">
                        <span>${this._escape(d.deviceName || 'Unnamed Device')}</span>
                        <span class="admin-badge admin-badge-${d.status === 'ONLINE' ? 'success' : 'neutral'}">${this._escape(d.status)}</span>
                      </div>
                      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:0.375rem;font-size:0.75rem;color:var(--admin-text-secondary);margin-top:0.375rem;">
                        <div>Platform: <strong>${this._escape(d.platform)}</strong></div>
                        <div>OS: <strong>${this._escape(d.osVersion || 'N/A')}</strong></div>
                        <div>App: <strong>${this._escape(d.appVersion || 'N/A')}</strong></div>
                        <div>Connection: <strong>${d.connection ? this._escape(d.connection.status) : 'DISCONNECTED'}</strong></div>
                        <div>Last Seen: ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</div>
                        <div>Registered: ${new Date(d.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No edge Android devices registered under this account.</div>`}
            </div>

            <!-- Server Daemons -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.875rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-text-primary);">
                ${ICONS.server} Node Server Daemons (${servers.length})
              </div>
              ${servers.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${servers.map(s => `
                    <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-size:0.8125rem;">
                      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;">
                        <span>${this._escape(s.serverName || 'Daemon')}</span>
                        <span class="admin-badge admin-badge-${s.status === 'RUNNING' ? 'success' : 'neutral'}">${this._escape(s.status)}</span>
                      </div>
                      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:0.375rem;font-size:0.75rem;color:var(--admin-text-secondary);margin-top:0.375rem;">
                        <div>Daemon ID: <code style="font-size:0.7rem;">${this._escape(s.id.substring(0, 10))}...</code></div>
                        <div>Host: <strong>${this._escape(s.endpoints?.[0]?.hostname || 'Internal Relay')}</strong></div>
                        <div>Started: ${s.startedAt ? new Date(s.startedAt).toLocaleString() : 'N/A'}</div>
                        <div>Heartbeat: ${s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toLocaleString() : 'N/A'}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No active file server daemons found.</div>`}
            </div>

            <!-- Commercial & Billing State -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.875rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-text-primary);">
                ${ICONS['credit-card']} Commercial &amp; Billing Summary
              </div>
              ${billing ? `
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:0.625rem;font-size:0.8125rem;">
                  <div><strong>Subscription State:</strong> <span class="admin-badge admin-badge-${billing.status === 'ACTIVE' ? 'success' : 'neutral'}">${this._escape(billing.status || 'FREE')}</span></div>
                  <div><strong>Active Plan:</strong> <strong>${this._escape(billing.activePlanCode || 'FREE')}</strong> (${this._escape(billing.planTier || 'COMMUNITY')})</div>
                  <div><strong>Country / Currency:</strong> ${this._escape(billing.billingCountry || 'IN')} / ${this._escape(billing.currency || 'INR')}</div>
                  <div><strong>Current Period End:</strong> ${billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toLocaleDateString() : 'N/A'}</div>
                  <div><strong>Payment Transactions:</strong> ${billing.totalPaymentsCount}</div>
                  <div><strong>Refund Records:</strong> ${billing.totalRefundsCount}</div>
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No commercial subscription ledger found. Customer is on Free Tier.</div>`}
            </div>

            <!-- Support Case History -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <div style="font-size:0.875rem;font-weight:700;color:var(--admin-text-primary);">
                  ${ICONS['life-buoy']} Support Case History (${casesSummary?.totalCases || 0} Total &bull; ${casesSummary?.openCases || 0} Open)
                </div>
              </div>
              ${recentCases.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${recentCases.map(rc => `
                    <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-size:0.8125rem;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-weight:600;">
                          <span style="font-family:monospace;color:var(--admin-primary);cursor:pointer;" onclick="AdminShell.inspectSupportCase('${rc.id}')">
                            ${this._escape(rc.caseNumber)}
                          </span>
                          &bull; ${this._escape(rc.subject)}
                        </div>
                        <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">
                          Created: ${new Date(rc.createdAt).toLocaleDateString()} &bull; Assigned: ${this._escape(rc.assignedAdminName || 'Unassigned')}
                        </div>
                      </div>
                      <div style="display:flex;gap:0.375rem;align-items:center;">
                        <span class="admin-badge admin-badge-${rc.status === 'RESOLVED' ? 'success' : (rc.status === 'OPEN' ? 'warning' : 'neutral')}">${this._escape(rc.status)}</span>
                        <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectSupportCase('${rc.id}')">
                          Inspect
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No previous support tickets recorded for this customer.</div>`}
            </div>
          </div>
        `;

        this._showDrawer(`Diagnostics: ${u.fullName || u.email}`, html);
      } catch (err) {
        this._showDrawer('Diagnostic Inspection Failed', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    async inspectSupportCase(caseId) {
      this._showDrawer('Support Case Inspection', `<div style="padding:2rem;text-align:center;">Loading case details...</div>`);

      try {
        const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}`);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to retrieve support case details');
        }

        const c = res.data;
        const canWrite = window.AdminAuth.hasPermission('support.write');
        const canAssign = window.AdminAuth.hasPermission('support.assign') || canWrite;
        const canNote = window.AdminAuth.hasPermission('support.notes') || canWrite;

        let priorityClass = 'neutral';
        if (c.priority === 'URGENT') priorityClass = 'danger';
        else if (c.priority === 'HIGH') priorityClass = 'warning';

        let statusClass = 'neutral';
        if (c.status === 'OPEN' || c.status === 'WAITING_ON_CUSTOMER') statusClass = 'warning';
        else if (c.status === 'IN_PROGRESS') statusClass = 'primary';
        else if (c.status === 'RESOLVED') statusClass = 'success';

        const escalationBadges = [];
        if (c.isUrgent) escalationBadges.push(`<span class="admin-badge admin-badge-danger" style="font-size:0.6875rem;">URGENT</span>`);
        if (c.isOverdue) escalationBadges.push(`<span class="admin-badge admin-badge-danger" style="font-size:0.6875rem;">OVERDUE (>24h Inactive)</span>`);
        if (c.needsAttention && !c.isUrgent && !c.isOverdue) escalationBadges.push(`<span class="admin-badge admin-badge-warning" style="font-size:0.6875rem;">NEEDS ATTENTION</span>`);
        if (c.isUnassigned) escalationBadges.push(`<span class="admin-badge admin-badge-warning" style="font-size:0.6875rem;">UNASSIGNED</span>`);

        const transitions = c.allowedTransitions || [];
        const transitionButtons = [];
        if (transitions.includes('OPEN')) {
          const label = (c.status === 'CLOSED' || c.status === 'RESOLVED') ? 'Reopen Case' : 'Mark Open';
          transitionButtons.push(`<button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.updateSupportCaseStatus('${c.id}', 'OPEN')">${label}</button>`);
        }
        if (transitions.includes('IN_PROGRESS')) {
          transitionButtons.push(`<button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.updateSupportCaseStatus('${c.id}', 'IN_PROGRESS')">In Progress</button>`);
        }
        if (transitions.includes('WAITING_ON_CUSTOMER')) {
          transitionButtons.push(`<button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.updateSupportCaseStatus('${c.id}', 'WAITING_ON_CUSTOMER')">Waiting on Customer</button>`);
        }
        if (transitions.includes('RESOLVED')) {
          transitionButtons.push(`<button class="admin-btn admin-btn-primary admin-btn-xs" onclick="AdminShell.updateSupportCaseStatus('${c.id}', 'RESOLVED')">Resolve Case</button>`);
        }
        if (transitions.includes('CLOSED')) {
          transitionButtons.push(`<button class="admin-btn admin-btn-danger admin-btn-xs" onclick="AdminShell.updateSupportCaseStatus('${c.id}', 'CLOSED')">Close Case</button>`);
        }

        const customer = c.customerContext?.user;
        const devices = c.customerContext?.devices || [];
        const servers = c.customerContext?.servers || [];
        const billing = c.customerContext?.billing;

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.5rem;">
            <!-- Top Summary Card -->
            <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
                <div>
                  <span style="font-family:monospace;font-size:1.125rem;font-weight:700;color:var(--admin-primary);">${this._escape(c.caseNumber)}</span>
                  <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">Created: ${new Date(c.createdAt).toLocaleString()}</div>
                </div>
                <div style="display:flex;gap:0.375rem;flex-wrap:wrap;justify-content:flex-end;">
                  ${escalationBadges.join(' ')}
                  <span class="admin-badge admin-badge-${priorityClass}">${this._escape(c.priority)}</span>
                  <span class="admin-badge admin-badge-${statusClass}">${this._escape(c.status)}</span>
                </div>
              </div>

              <div style="font-size:1rem;font-weight:700;color:var(--admin-text-primary);margin-bottom:0.5rem;">
                ${this._escape(c.subject)}
              </div>
              <div style="font-size:0.8125rem;color:var(--admin-text-secondary);background:var(--admin-bg-base);padding:0.75rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);white-space:pre-wrap;line-height:1.5;">
                ${this._escape(c.description)}
              </div>

              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;font-size:0.75rem;color:var(--admin-text-muted);">
                <div>Category: <strong>${this._escape(c.category)}</strong></div>
                <div>Assigned: <strong>${c.assignedAdmin ? this._escape(c.assignedAdmin.name) : 'Unassigned'}</strong></div>
              </div>
            </div>

            <!-- Lifecycle State Actions -->
            ${(canWrite || canAssign) ? `
              <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
                <div style="font-size:0.8125rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-text-primary);">Lifecycle &amp; Assignment Controls</div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
                  ${canWrite ? transitionButtons.join(' ') : ''}
                  ${transitionButtons.length === 0 && canWrite ? `<span style="font-size:0.75rem;color:var(--admin-text-muted);font-style:italic;">No further state transitions permitted from current status.</span>` : ''}
                  ${canAssign ? `
                    <button class="admin-btn admin-btn-secondary admin-btn-xs" style="margin-left:auto;" onclick="AdminShell.showAssignSupportCaseModal('${c.id}', '${c.assignedAdminId || ''}')">
                      ${c.assignedAdminId ? 'Reassign Agent' : 'Assign Agent'}
                    </button>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            <!-- Customer Identity Summary -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Customer Account Context</div>
                <div style="display:flex;gap:0.375rem;">
                  ${customer ? `<button class="admin-btn admin-btn-primary admin-btn-xs" onclick="AdminShell.inspectSupportCustomerContext('${customer.id}')">${ICONS.search} Diagnostics</button>` : ''}
                  ${customer ? `<button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectUser('${customer.id}')">${ICONS.eye} Inspect Account</button>` : ''}
                </div>
              </div>
              ${customer ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.8125rem;">
                  <div><strong>Email:</strong> ${this._escape(customer.email)}</div>
                  <div><strong>Full Name:</strong> ${this._escape(customer.fullName || 'Not provided')}</div>
                  <div><strong>Status:</strong> ${this._escape(customer.status)}</div>
                  <div><strong>Verified:</strong> ${customer.emailVerified ? 'Yes' : 'No'}</div>
                  <div><strong>User ID:</strong> <code style="font-size:0.75rem;">${this._escape(customer.id)}</code></div>
                  <div><strong>Member Since:</strong> ${new Date(customer.createdAt).toLocaleDateString()}</div>
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">Customer metadata unavailable.</div>`}
            </div>

            <!-- Hardware & Server Diagnostics Context -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.8125rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);">
                Edge Hardware &amp; Server Daemons (${devices.length} Devices / ${servers.length} Daemons)
              </div>
              ${devices.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${devices.map(d => `
                    <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.5rem 0.75rem;font-size:0.8125rem;">
                      <div style="display:flex;justify-content:space-between;font-weight:600;">
                        <span>${this._escape(d.deviceName)} (${this._escape(d.platform)})</span>
                        <span class="admin-badge admin-badge-${d.status === 'ONLINE' ? 'success' : 'neutral'}">${this._escape(d.status)}</span>
                      </div>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:2px;">
                        Device ID: <code>${this._escape(d.id)}</code> &bull; Last Seen: ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No registered Android edge devices found for this account.</div>`}
            </div>

            <!-- Commercial / Billing Context -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.8125rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);">Commercial &amp; Billing Summary</div>
              ${billing ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.8125rem;">
                  <div><strong>Billing State:</strong> <span class="admin-badge admin-badge-${billing.status === 'ACTIVE' ? 'success' : 'neutral'}">${this._escape(billing.status || 'FREE')}</span></div>
                  <div><strong>Active Plan:</strong> <strong>${this._escape(billing.activePlanCode || 'FREE')}</strong></div>
                  <div><strong>Country / Currency:</strong> ${this._escape(billing.billingCountry || 'IN')} / ${this._escape(billing.currency || 'INR')}</div>
                  <div><strong>Current Period End:</strong> ${billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toLocaleDateString() : 'N/A'}</div>
                  <div><strong>Total Payments:</strong> ${billing.totalPaymentsCount}</div>
                  <div><strong>Total Refunds:</strong> ${billing.totalRefundsCount}</div>
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No active billing ledger or free tier account.</div>`}
            </div>

            <!-- Resolution Notes if any -->
            ${c.resolutionNotes ? `
              <div style="background:var(--admin-bg-subtle);border-left:3px solid var(--admin-success);border-radius:var(--radius-xs);padding:0.75rem 1rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-success);margin-bottom:0.25rem;">Resolution Notes</div>
                <div style="font-size:0.8125rem;color:var(--admin-text-primary);white-space:pre-wrap;">${this._escape(c.resolutionNotes)}</div>
              </div>
            ` : ''}

            <!-- Internal Operator Notes -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Internal Operator Notes (${c.notes.length})</div>
                ${canNote ? `
                  <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.showAddSupportNoteModal('${c.id}')">
                    + Add Note
                  </button>
                ` : ''}
              </div>

              ${c.notes.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.625rem;">
                  ${c.notes.map(n => `
                    <div style="background:var(--admin-bg-subtle);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-size:0.8125rem;">
                      <div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:0.25rem;">
                        <span style="color:var(--admin-primary);">${this._escape(n.adminName)}</span>
                        <span style="font-size:0.75rem;color:var(--admin-text-muted);">${new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                      <div style="white-space:pre-wrap;line-height:1.4;">${this._escape(n.note)}</div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No operator notes added yet.</div>`}
            </div>
          </div>
        `;

        this._showDrawer(`Case: ${c.caseNumber}`, html);
      } catch (err) {
        this._showDrawer('Inspection Error', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    showCreateSupportCaseModal(defaultUserId = '') {
      const existing = document.getElementById('adminSupportCreateModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminSupportCreateModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" style="max-width:540px;" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Create Customer Support Ticket</h3>
            <button class="admin-btn-icon" id="supCreateCloseBtn" aria-label="Close modal">${ICONS.x}</button>
          </div>
          <div class="admin-modal-body">
            <div style="display:flex;flex-direction:column;gap:0.875rem;">
              <div>
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Customer User ID <span style="color:var(--admin-danger);">*</span></label>
                <input type="text" id="supNewUserId" class="admin-search-input" value="${this._escape(defaultUserId)}" placeholder="cuid or user ID" style="width:100%;padding-left:0.75rem;">
              </div>
              <div>
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Subject <span style="color:var(--admin-danger);">*</span></label>
                <input type="text" id="supNewSubject" class="admin-search-input" placeholder="Brief issue summary" style="width:100%;padding-left:0.75rem;">
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                <div>
                  <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Category</label>
                  <select id="supNewCategory" class="admin-select" style="width:100%;">
                    <option value="GENERAL">General</option>
                    <option value="ACCOUNT">Account</option>
                    <option value="DEVICE">Device</option>
                    <option value="SERVER">Server</option>
                    <option value="FILE_ACCESS">File Access</option>
                    <option value="BILLING">Billing</option>
                    <option value="CONNECTION">Connection</option>
                    <option value="SECURITY">Security</option>
                  </select>
                </div>
                <div>
                  <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Priority</label>
                  <select id="supNewPriority" class="admin-select" style="width:100%;">
                    <option value="LOW">Low</option>
                    <option value="NORMAL" selected>Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Issue Description <span style="color:var(--admin-danger);">*</span></label>
                <textarea id="supNewDescription" class="admin-search-input" rows="4" placeholder="Detailed description of customer inquiry or technical issue..." style="width:100%;padding-left:0.625rem;padding-right:0.625rem;resize:vertical;"></textarea>
              </div>
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="supCreateCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="supCreateSubmitBtn">Create Ticket</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeModal = () => backdrop.remove();
      document.getElementById('supCreateCloseBtn')?.addEventListener('click', closeModal);
      document.getElementById('supCreateCancelBtn')?.addEventListener('click', closeModal);

      document.getElementById('supCreateSubmitBtn')?.addEventListener('click', async () => {
        const userId = document.getElementById('supNewUserId')?.value.trim();
        const subject = document.getElementById('supNewSubject')?.value.trim();
        const category = document.getElementById('supNewCategory')?.value;
        const priority = document.getElementById('supNewPriority')?.value;
        const description = document.getElementById('supNewDescription')?.value.trim();

        if (!userId || !subject || !description) {
          this.toast('Please provide customer User ID, Subject, and Description', 'warning');
          return;
        }

        const submitBtn = document.getElementById('supCreateSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
          const res = await window.AdminAuth.fetchWithAuth('/api/v1/admin/operations/support/cases', {
            method: 'POST',
            body: JSON.stringify({ userId, subject, description, category, priority })
          });

          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to create support ticket');
          }

          this.toast(`Support ticket ${res.data.caseNumber} created successfully`, 'success');
          closeModal();
          this.loadSupportCases(1);
        } catch (err) {
          this.toast(err.message, 'danger');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    async showAssignSupportCaseModal(caseId, currentAssignedAdminId) {
      const existing = document.getElementById('adminSupportAssignModalBackdrop');
      if (existing) existing.remove();

      let eligibleAdmins = [];
      try {
        const res = await window.AdminAuth.fetchWithAuth('/api/v1/admin/operations/support/assignees');
        if (res.success && res.data?.assignees) {
          eligibleAdmins = res.data.assignees;
        }
      } catch (err) {
        // Continue with empty list if fetch fails
      }

      const backdrop = document.createElement('div');
      backdrop.id = 'adminSupportAssignModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" style="max-width:480px;" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Assign Support Case</h3>
            <button class="admin-btn-icon" id="supAssignCloseBtn" aria-label="Close modal">${ICONS.x}</button>
          </div>
          <div class="admin-modal-body">
            <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Eligible Support Administrator</label>
            <select id="supAssignAdminSelect" class="admin-select" style="width:100%;">
              <option value="">-- Unassigned --</option>
              ${eligibleAdmins.map(a => `
                <option value="${this._escape(a.id)}" ${a.id === currentAssignedAdminId ? 'selected' : ''}>
                  ${this._escape(a.name)} (${this._escape(a.email)}) &mdash; ${this._escape(a.role || (a.isSuperAdmin ? 'Super Admin' : 'Support Agent'))}
                </option>
              `).join('')}
            </select>
            <p style="font-size:0.75rem;color:var(--admin-text-muted);margin-top:0.5rem;">Only active administrators with support permissions or Super Admin privileges are listed.</p>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="supAssignCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="supAssignSubmitBtn">Save Assignment</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeModal = () => backdrop.remove();
      document.getElementById('supAssignCloseBtn')?.addEventListener('click', closeModal);
      document.getElementById('supAssignCancelBtn')?.addEventListener('click', closeModal);

      document.getElementById('supAssignSubmitBtn')?.addEventListener('click', async () => {
        const select = document.getElementById('supAssignAdminSelect');
        const assignedAdminId = select ? (select.value || null) : null;

        const submitBtn = document.getElementById('supAssignSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
          const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ assignedAdminId })
          });

          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to update assignment');
          }

          this.toast('Support case assignment updated successfully', 'success');
          closeModal();
          this.inspectSupportCase(caseId);
          this.loadSupportCases(this.supportState.page);
        } catch (err) {
          this.toast(err.message, 'danger');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    showAddSupportNoteModal(caseId) {
      const existing = document.getElementById('adminSupportNoteModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminSupportNoteModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" style="max-width:480px;" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Add Internal Operator Note</h3>
            <button class="admin-btn-icon" id="supNoteCloseBtn" aria-label="Close modal">${ICONS.x}</button>
          </div>
          <div class="admin-modal-body">
            <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;">Operator Note <span style="color:var(--admin-danger);">*</span></label>
            <textarea id="supNoteText" class="admin-search-input" rows="4" placeholder="Enter diagnostic observations, actions taken, or escalation notes..." style="width:100%;padding:0.625rem;resize:vertical;"></textarea>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="supNoteCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="supNoteSubmitBtn">Save Note</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeModal = () => backdrop.remove();
      document.getElementById('supNoteCloseBtn')?.addEventListener('click', closeModal);
      document.getElementById('supNoteCancelBtn')?.addEventListener('click', closeModal);

      document.getElementById('supNoteSubmitBtn')?.addEventListener('click', async () => {
        const note = document.getElementById('supNoteText')?.value.trim();
        if (!note) {
          this.toast('Please enter note content', 'warning');
          return;
        }

        const submitBtn = document.getElementById('supNoteSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
          const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ note, isInternal: true })
          });

          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to add operator note');
          }

          this.toast('Internal operator note added', 'success');
          closeModal();
          this.inspectSupportCase(caseId);
          this.loadSupportCases(this.supportState.page);
        } catch (err) {
          this.toast(err.message, 'danger');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    async updateSupportCaseStatus(caseId, newStatus) {
      if (newStatus === 'RESOLVED') {
        this.showConfirmModal({
          title: 'Resolve Support Case',
          message: 'Provide the administrative resolution summary for this case before marking it resolved:',
          requireReason: true,
          confirmLabel: 'Resolve Case',
          confirmType: 'primary',
          onConfirm: async (reason) => {
            if (!reason || !reason.trim()) {
              throw new Error('Resolution notes are required when resolving a support case.');
            }
            const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'RESOLVED', resolutionNotes: reason.trim() })
            });

            if (!res.success) {
              throw new Error(res.error?.message || 'Failed to resolve case');
            }

            this.toast('Support case resolved successfully', 'success');
            this.inspectSupportCase(caseId);
            this.loadSupportCases(this.supportState.page);
          }
        });
      } else if (newStatus === 'CLOSED') {
        this.showConfirmModal({
          title: 'Close Support Case',
          message: 'Are you sure you want to close this support case? Closed cases cannot be modified unless reopened.',
          requireReason: true,
          confirmLabel: 'Close Case',
          confirmType: 'danger',
          onConfirm: async (reason) => {
            const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'CLOSED', resolutionNotes: reason?.trim() || undefined })
            });

            if (!res.success) {
              throw new Error(res.error?.message || 'Failed to close case');
            }

            this.toast('Support case closed', 'success');
            this.inspectSupportCase(caseId);
            this.loadSupportCases(this.supportState.page);
          }
        });
      } else if (newStatus === 'OPEN') {
        this.showConfirmModal({
          title: 'Reopen Support Case',
          message: 'Are you sure you want to reopen this support case and return it to the active queue?',
          requireReason: false,
          confirmLabel: 'Reopen Case',
          confirmType: 'warning',
          onConfirm: async () => {
            const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'OPEN' })
            });

            if (!res.success) {
              throw new Error(res.error?.message || 'Failed to reopen case');
            }

            this.toast('Support case reopened', 'success');
            this.inspectSupportCase(caseId);
            this.loadSupportCases(this.supportState.page);
          }
        });
      } else {
        try {
          const res = await window.AdminAuth.fetchWithAuth(`/api/v1/admin/operations/support/cases/${caseId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
          });

          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to update case status');
          }

          this.toast(`Support case status updated to ${newStatus}`, 'success');
          this.inspectSupportCase(caseId);
          this.loadSupportCases(this.supportState.page);
        } catch (err) {
          this.toast(err.message, 'danger');
        }
      }
    }

    _renderForbiddenView(item) {
      const contentContainer = document.getElementById('adminViewContainer');
      if (!contentContainer) return;

      contentContainer.innerHTML = `
        <div class="admin-forbidden-box">
          <div class="admin-forbidden-icon">${ICONS.shield}</div>
          <h2 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-danger);">403 Access Forbidden</h2>
          <p style="font-size:0.9375rem;color:var(--admin-text-secondary);margin-bottom:1.5rem;line-height:1.6;">
            Your account does not have permission to access <strong>${this._escape(item.label)}</strong>.
          </p>
          <div class="admin-required-perms" style="margin:0 auto 1.5rem auto;max-width:400px;">
            <span><strong>Target Module:</strong> <code>${this._escape(item.id)}</code></span>
            <span><strong>Required Permission:</strong> <code style="color:var(--admin-danger);">${this._escape(item.permission)}</code></span>
          </div>
          <div>
            <a href="#dashboard" class="admin-btn admin-btn-primary admin-btn-sm" style="display:inline-flex;">
              Return to Operations Dashboard
            </a>
          </div>
        </div>
      `;
    }

    /* =========================================================================
       7. REUSABLE UI HELPERS (Modals, Drawers, Badges, Pagination, Toasts)
       ========================================================================= */
    _renderStatusBadge(status) {
      if (!status) return `<span class="admin-badge admin-badge-neutral">UNKNOWN</span>`;
      const s = String(status).toUpperCase();

      if (s === 'ACTIVE' || s === 'ONLINE' || s === 'RUNNING' || s === 'CONNECTED') {
        return `<span class="admin-badge admin-badge-success"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      if (s === 'STARTING' || s === 'CONNECTING' || s === 'RECONNECTING' || s === 'MAINTENANCE') {
        return `<span class="admin-badge admin-badge-warning"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      if (s === 'SUSPENDED' || s === 'OFFLINE' || s === 'STOPPED' || s === 'ERROR' || s === 'FAILED' || s === 'INACTIVE') {
        return `<span class="admin-badge admin-badge-danger"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      return `<span class="admin-badge admin-badge-neutral">${this._escape(s)}</span>`;
    }

    _renderPagination(containerId, state, onPageChange) {
      const el = document.getElementById(containerId);
      if (!el) return;

      const totalPages = Math.ceil(state.total / state.pageSize) || 1;
      const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
      const end = Math.min(state.page * state.pageSize, state.total);

      el.innerHTML = `
        <div>Showing <strong>${start}–${end}</strong> of <strong>${state.total}</strong> results</div>
        <div class="admin-pagination-controls">
          <button class="admin-pagination-btn" ${state.page <= 1 ? 'disabled' : ''} id="${containerId}_prev">Prev</button>
          <span style="padding:0 0.5rem;font-weight:600;">Page ${state.page} of ${totalPages}</span>
          <button class="admin-pagination-btn" ${state.page >= totalPages ? 'disabled' : ''} id="${containerId}_next">Next</button>
        </div>
      `;

      const prevBtn = document.getElementById(`${containerId}_prev`);
      const nextBtn = document.getElementById(`${containerId}_next`);

      if (prevBtn && state.page > 1) {
        prevBtn.addEventListener('click', () => onPageChange(state.page - 1));
      }
      if (nextBtn && state.page < totalPages) {
        nextBtn.addEventListener('click', () => onPageChange(state.page + 1));
      }
    }

    _showDrawer(title, htmlContent) {
      this._closeDrawer();

      const backdrop = document.getElementById('adminDrawerBackdrop');
      const drawer = document.createElement('div');
      drawer.id = 'adminDetailDrawer';
      drawer.className = 'admin-drawer-container';

      const header = document.createElement('div');
      header.className = 'admin-drawer-header';

      const titleEl = document.createElement('h2');
      titleEl.style.cssText = 'font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin:0;';
      titleEl.textContent = title;
      header.appendChild(titleEl);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'admin-btn-icon';
      closeBtn.setAttribute('aria-label', 'Close drawer');
      closeBtn.innerHTML = ICONS.x || '✕';
      closeBtn.addEventListener('click', () => this._closeDrawer());
      header.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'admin-drawer-body';

      if (htmlContent instanceof Node) {
        body.appendChild(htmlContent);
      } else {
        body.innerHTML = String(htmlContent);
      }

      drawer.appendChild(header);
      drawer.appendChild(body);
      document.body.appendChild(drawer);

      if (backdrop) {
        backdrop.classList.add('active');
        backdrop.onclick = () => this._closeDrawer();
      }

      requestAnimationFrame(() => {
        drawer.classList.add('open');
      });
    }

    _closeDrawer() {
      const drawer = document.getElementById('adminDetailDrawer');
      const backdrop = document.getElementById('adminDrawerBackdrop');
      if (drawer) {
        drawer.classList.remove('open');
        setTimeout(() => drawer.remove(), 200);
      }
      if (backdrop) {
        backdrop.classList.remove('active');
      }
    }

    showConfirmModal({ title, message, warningText, confirmLabel = 'Confirm', confirmType = 'primary', requireReason = false, onConfirm }) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">${this._escape(title)}</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;">${message}</p>
            ${warningText ? `
              <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);margin-bottom:1rem;font-size:0.8125rem;color:var(--admin-warning);">
                <strong>Notice:</strong> ${this._escape(warningText)}
              </div>
            ` : ''}
            ${requireReason ? `
              <div style="margin-top:1rem;">
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                  Administrative Reason (Optional):
                </label>
                <input type="text" id="adminModalReasonInput" class="admin-search-input" maxlength="255" placeholder="e.g. Scheduled maintenance, policy compliance..." style="padding-left:0.875rem;">
              </div>
            ` : ''}
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-${confirmType}" id="adminModalConfirmBtn">${this._escape(confirmLabel)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmBtn');
      const reasonInput = document.getElementById('adminModalReasonInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Processing...';
          const reason = reasonInput ? reasonInput.value.trim() : '';
          try {
            await onConfirm(reason);
            closeModal();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = confirmLabel;
            this.toast(err.message || 'Operation failed', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });

      window.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
          closeModal();
          window.removeEventListener('keydown', escHandler);
        }
      });
    }

    copyErrorText(text, label = 'Text') {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.toast(`${label} copied to clipboard`, 'info', 2000);
        }).catch(() => {
          this._fallbackCopyText(text, label);
        });
      } else {
        this._fallbackCopyText(text, label);
      }
    }

    _fallbackCopyText(text, label) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        this.toast(`${label} copied to clipboard`, 'info', 2000);
      } catch (e) {
        this.toast(`Failed to copy ${label}`, 'danger');
      }
      ta.remove();
    }

    /* =========================================================================
       8. OBSERVABILITY & ERROR CENTER (Phase 12.6)
       ========================================================================= */
    _renderErrorCenterView(container) {
      if (!window.AdminAuth.hasPermission('errors.read')) {
        this._renderForbiddenView({ id: 'observability-center', label: 'Observability & Error Center', permission: 'errors.read' });
        return;
      }

      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Observability &amp; Error Center</h1>
            <p class="admin-view-subtitle">Monitor runtime errors, inspect diagnostic fingerprints, and manage incident lifecycles across backend, android, and gateway components.</p>
          </div>
          <div class="admin-view-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="btnRefreshErrors">
              ${ICONS.rotate} Refresh
            </button>
          </div>
        </div>

        <!-- Summary KPI Cards -->
        <div class="admin-summary-strip" id="errorCenterSummaryStrip">
          <div class="admin-summary-card">
            <div class="admin-summary-label">Total Incidents</div>
            <div class="admin-summary-value" id="kpiTotalIncidents">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Open Incidents</div>
            <div class="admin-summary-value" id="kpiOpenIncidents" style="color:var(--admin-danger);">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Critical / High</div>
            <div class="admin-summary-value" id="kpiCriticalIncidents" style="color:#ef4444;">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Muted Incidents</div>
            <div class="admin-summary-value" id="kpiMutedIncidents" style="color:var(--admin-text-muted);">-</div>
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="admin-toolbar" style="margin-bottom:1rem;">
          <div class="admin-toolbar-left" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
            <div class="admin-search-wrapper" style="width:240px;">
              <span class="admin-search-icon">${ICONS.search}</span>
              <input type="search" id="inputErrorSearch" class="admin-search-input" placeholder="Search message, code, hash..." value="${this._escape(this.errorCenterState.search)}">
            </div>

            <select id="selectErrorStatus" class="admin-select" style="width:130px;">
              <option value="" ${!this.errorCenterState.status ? 'selected' : ''}>All Statuses</option>
              <option value="OPEN" ${this.errorCenterState.status === 'OPEN' ? 'selected' : ''}>Open</option>
              <option value="ACKNOWLEDGED" ${this.errorCenterState.status === 'ACKNOWLEDGED' ? 'selected' : ''}>Acknowledged</option>
              <option value="RESOLVED" ${this.errorCenterState.status === 'RESOLVED' ? 'selected' : ''}>Resolved</option>
              <option value="MUTED" ${this.errorCenterState.status === 'MUTED' ? 'selected' : ''}>Muted</option>
            </select>

            <select id="selectErrorSeverity" class="admin-select" style="width:130px;">
              <option value="" ${!this.errorCenterState.severity ? 'selected' : ''}>All Severities</option>
              <option value="CRITICAL" ${this.errorCenterState.severity === 'CRITICAL' ? 'selected' : ''}>Critical</option>
              <option value="HIGH" ${this.errorCenterState.severity === 'HIGH' ? 'selected' : ''}>High</option>
              <option value="MEDIUM" ${this.errorCenterState.severity === 'MEDIUM' ? 'selected' : ''}>Medium</option>
              <option value="LOW" ${this.errorCenterState.severity === 'LOW' ? 'selected' : ''}>Low</option>
            </select>

            <select id="selectErrorComponent" class="admin-select" style="width:130px;">
              <option value="" ${!this.errorCenterState.component ? 'selected' : ''}>All Components</option>
              <option value="BACKEND" ${this.errorCenterState.component === 'BACKEND' ? 'selected' : ''}>Backend</option>
              <option value="ANDROID" ${this.errorCenterState.component === 'ANDROID' ? 'selected' : ''}>Android</option>
              <option value="GATEWAY" ${this.errorCenterState.component === 'GATEWAY' ? 'selected' : ''}>Gateway</option>
              <option value="FRONTEND" ${this.errorCenterState.component === 'FRONTEND' ? 'selected' : ''}>Frontend</option>
              <option value="DATABASE" ${this.errorCenterState.component === 'DATABASE' ? 'selected' : ''}>Database</option>
              <option value="UNKNOWN" ${this.errorCenterState.component === 'UNKNOWN' ? 'selected' : ''}>Unknown</option>
            </select>

            <select id="selectErrorSort" class="admin-select" style="width:140px;">
              <option value="updatedAt_desc" ${this.errorCenterState.sortBy === 'updatedAt' && this.errorCenterState.sortOrder === 'desc' ? 'selected' : ''}>Updated (Newest)</option>
              <option value="lastSeenAt_desc" ${this.errorCenterState.sortBy === 'lastSeenAt' && this.errorCenterState.sortOrder === 'desc' ? 'selected' : ''}>Last Seen (Newest)</option>
              <option value="firstSeenAt_desc" ${this.errorCenterState.sortBy === 'firstSeenAt' && this.errorCenterState.sortOrder === 'desc' ? 'selected' : ''}>First Seen (Newest)</option>
              <option value="occurrenceCount_desc" ${this.errorCenterState.sortBy === 'occurrenceCount' && this.errorCenterState.sortOrder === 'desc' ? 'selected' : ''}>Count (Highest)</option>
              <option value="severity_desc" ${this.errorCenterState.sortBy === 'severity' && this.errorCenterState.sortOrder === 'desc' ? 'selected' : ''}>Severity (Highest)</option>
            </select>

            <button class="admin-btn admin-btn-secondary admin-btn-xs" id="btnResetErrorFilters" title="Reset all filters">Reset</button>
          </div>
        </div>

        <!-- Incidents Table Container -->
        <div class="admin-card">
          <div class="admin-card-body" style="padding:0;">
            <div class="admin-table-wrapper" id="errorIncidentsTableWrapper">
              <div style="padding:2rem;text-align:center;color:var(--admin-text-muted);">Loading incidents...</div>
            </div>
          </div>
          <div class="admin-card-footer" id="errorIncidentsPagination" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;"></div>
        </div>
      `;

      // Event bindings
      const searchInput = document.getElementById('inputErrorSearch');
      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.errorCenterState.search = e.target.value.trim();
            this.loadErrorIncidents(1);
          }, 300);
        });
      }

      const statusSelect = document.getElementById('selectErrorStatus');
      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.errorCenterState.status = e.target.value;
          this.loadErrorIncidents(1);
        });
      }

      const severitySelect = document.getElementById('selectErrorSeverity');
      if (severitySelect) {
        severitySelect.addEventListener('change', (e) => {
          this.errorCenterState.severity = e.target.value;
          this.loadErrorIncidents(1);
        });
      }

      const compSelect = document.getElementById('selectErrorComponent');
      if (compSelect) {
        compSelect.addEventListener('change', (e) => {
          this.errorCenterState.component = e.target.value;
          this.loadErrorIncidents(1);
        });
      }

      const sortSelect = document.getElementById('selectErrorSort');
      if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
          const [by, ord] = e.target.value.split('_');
          this.errorCenterState.sortBy = by || 'updatedAt';
          this.errorCenterState.sortOrder = ord || 'desc';
          this.loadErrorIncidents(1);
        });
      }

      const resetBtn = document.getElementById('btnResetErrorFilters');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.errorCenterState.search = '';
          this.errorCenterState.status = '';
          this.errorCenterState.severity = '';
          this.errorCenterState.component = '';
          this.errorCenterState.sortBy = 'updatedAt';
          this.errorCenterState.sortOrder = 'desc';
          this._renderErrorCenterView(container);
        });
      }

      const refreshBtn = document.getElementById('btnRefreshErrors');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          this.loadErrorIncidents(this.errorCenterState.page);
        });
      }

      this.loadErrorIncidents(1);
    }

    async loadErrorIncidents(page = 1) {
      this.errorCenterState.page = page;
      const wrapper = document.getElementById('errorIncidentsTableWrapper');
      if (wrapper) {
        wrapper.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--admin-text-muted);">Loading incidents...</div>`;
      }

      try {
        const query = {
          page: this.errorCenterState.page,
          pageSize: this.errorCenterState.pageSize,
          sortBy: this.errorCenterState.sortBy,
          sortOrder: this.errorCenterState.sortOrder
        };

        if (this.errorCenterState.search) query.search = this.errorCenterState.search;
        if (this.errorCenterState.status) query.status = this.errorCenterState.status;
        if (this.errorCenterState.severity) query.severity = this.errorCenterState.severity;
        if (this.errorCenterState.component) query.component = this.errorCenterState.component;

        const res = await window.AdminApi.listErrorIncidents(query);

        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to load error incidents');
        }

        const items = res.data?.items || [];
        const pagination = res.data?.pagination || { page, pageSize: this.errorCenterState.pageSize, total: 0, totalPages: 0 };
        this.errorCenterState.items = items;
        this.errorCenterState.total = pagination.total || 0;
        this.errorCenterState.totalPages = pagination.totalPages || 0;

        // Update KPI counters based on current batch and summary
        const totalEl = document.getElementById('kpiTotalIncidents');
        const openEl = document.getElementById('kpiOpenIncidents');
        const critEl = document.getElementById('kpiCriticalIncidents');
        const muteEl = document.getElementById('kpiMutedIncidents');

        if (totalEl) totalEl.textContent = pagination.total.toLocaleString();
        if (openEl) openEl.textContent = items.filter(i => i.status === 'OPEN').length.toLocaleString();
        if (critEl) critEl.textContent = items.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length.toLocaleString();
        if (muteEl) muteEl.textContent = items.filter(i => i.status === 'MUTED').length.toLocaleString();

        this._renderErrorIncidentTable(items);
        this._renderPagination('errorIncidentsPagination', this.errorCenterState, (newPage) => {
          this.loadErrorIncidents(newPage);
        });
      } catch (err) {
        if (wrapper) {
          const reqIdHtml = err.requestId ? `
            <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--admin-text-muted);">
              Request ID: <code style="font-family:'JetBrains Mono',monospace;">${this._escape(err.requestId)}</code>
              <button class="admin-btn admin-btn-xs admin-btn-secondary" style="margin-left:0.25rem;padding:1px 6px;" onclick="AdminShell.copyErrorText('${this._escape(err.requestId)}', 'Request ID')">Copy</button>
            </div>
          ` : '';
          wrapper.innerHTML = `
            <div style="padding:2rem;text-align:center;color:var(--admin-danger);">
              <div style="font-weight:600;margin-bottom:0.25rem;">Failed to load error incidents</div>
              <div style="font-size:0.875rem;">${this._escape(err.message)}</div>
              ${reqIdHtml}
              <button class="admin-btn admin-btn-secondary admin-btn-xs" style="margin-top:1rem;" onclick="AdminShell.loadErrorIncidents(1)">Retry</button>
            </div>
          `;
        }
      }
    }

    _renderErrorIncidentTable(items) {
      const wrapper = document.getElementById('errorIncidentsTableWrapper');
      if (!wrapper) return;

      if (!items || items.length === 0) {
        wrapper.innerHTML = `
          <div style="padding:3rem 1rem;text-align:center;color:var(--admin-text-muted);">
            <div style="font-size:2rem;margin-bottom:0.5rem;">🛡️</div>
            <div style="font-weight:600;font-size:1rem;color:var(--admin-text-primary);">No error incidents found</div>
            <div style="font-size:0.8125rem;margin-top:0.25rem;">There are no operational errors matching your active filter criteria.</div>
          </div>
        `;
        return;
      }

      wrapper.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th style="width:90px;">Severity</th>
              <th style="width:110px;">Status</th>
              <th style="width:95px;">Component</th>
              <th>Error Code &amp; Message</th>
              <th style="width:80px;text-align:right;">Count</th>
              <th style="width:150px;">Last Seen</th>
              <th style="width:130px;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(inc => {
              const fp = inc.fingerprint || {};
              const errorCode = fp.errorCode || 'UNKNOWN_ERROR';
              const message = fp.normalizedMessage || inc.title || 'No message provided';
              const lastSeen = inc.lastSeenAt ? new Date(inc.lastSeenAt).toLocaleString() : 'N/A';
              const count = inc.occurrenceCount || 1;

              return `
                <tr>
                  <td>${this._renderSeverityBadge(inc.severity)}</td>
                  <td>${this._renderIncidentStatusBadge(inc.status)}</td>
                  <td><span class="admin-badge admin-badge-neutral" style="font-size:0.6875rem;font-weight:600;">${this._escape(fp.component || 'BACKEND')}</span></td>
                  <td>
                    <div style="font-weight:600;font-size:0.8125rem;color:var(--admin-text-primary);font-family:'JetBrains Mono',monospace;">
                      ${this._escape(errorCode)}
                    </div>
                    <div style="font-size:0.75rem;color:var(--admin-text-secondary);max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;" title="${this._escape(message)}">
                      ${this._escape(message)}
                    </div>
                  </td>
                  <td style="text-align:right;font-weight:700;font-family:'JetBrains Mono',monospace;">
                    ${count > 999 ? count.toLocaleString() : count}
                  </td>
                  <td style="font-size:0.75rem;color:var(--admin-text-muted);white-space:nowrap;">
                    ${lastSeen}
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectIncident('${inc.id}')" title="Inspect Incident">
                      ${ICONS.eye} View
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    _renderSeverityBadge(severity) {
      if (!severity) return `<span class="admin-badge admin-badge-neutral">UNKNOWN</span>`;
      const s = String(severity).toUpperCase();
      if (s === 'CRITICAL') {
        return `<span class="admin-badge admin-badge-critical"><span class="admin-status-dot"></span> CRITICAL</span>`;
      }
      if (s === 'HIGH') {
        return `<span class="admin-badge admin-badge-danger"><span class="admin-status-dot"></span> HIGH</span>`;
      }
      if (s === 'MEDIUM') {
        return `<span class="admin-badge admin-badge-warning"><span class="admin-status-dot"></span> MEDIUM</span>`;
      }
      if (s === 'LOW') {
        return `<span class="admin-badge admin-badge-info"><span class="admin-status-dot"></span> LOW</span>`;
      }
      return `<span class="admin-badge admin-badge-neutral">${this._escape(s)}</span>`;
    }

    _renderIncidentStatusBadge(status) {
      if (!status) return `<span class="admin-badge admin-badge-neutral">UNKNOWN</span>`;
      const s = String(status).toUpperCase();
      if (s === 'OPEN') {
        return `<span class="admin-badge admin-badge-status-open"><span class="admin-status-dot"></span> OPEN</span>`;
      }
      if (s === 'ACKNOWLEDGED') {
        return `<span class="admin-badge admin-badge-status-acknowledged"><span class="admin-status-dot"></span> ACKNOWLEDGED</span>`;
      }
      if (s === 'RESOLVED') {
        return `<span class="admin-badge admin-badge-status-resolved"><span class="admin-status-dot"></span> RESOLVED</span>`;
      }
      if (s === 'MUTED') {
        return `<span class="admin-badge admin-badge-status-muted"><span class="admin-status-dot"></span> MUTED</span>`;
      }
      return `<span class="admin-badge admin-badge-neutral">${this._escape(s)}</span>`;
    }

    async inspectIncident(incidentId) {
      try {
        const res = await window.AdminApi.getErrorIncident(incidentId);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to fetch incident details');
        }

        const inc = res.data?.incident;
        if (!inc) throw new Error('Incident not found');

        const fp = inc.fingerprint || {};
        const occurrences = inc.occurrences || [];
        const canManage = window.AdminAuth.hasPermission('errors.manage');

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <!-- Header Summary Card -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
                <div>
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                    ${this._renderSeverityBadge(inc.severity)}
                    ${this._renderIncidentStatusBadge(inc.status)}
                    <span class="admin-badge admin-badge-neutral">${this._escape(fp.component || 'BACKEND')}</span>
                  </div>
                  <h3 style="font-size:1.125rem;font-weight:700;margin:0.25rem 0;color:var(--admin-text-primary);font-family:'JetBrains Mono',monospace;">
                    ${this._escape(fp.errorCode || 'UNKNOWN_ERROR')}
                  </h3>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:1.25rem;font-weight:700;color:var(--admin-text-primary);font-family:'JetBrains Mono',monospace;">
                    ${(inc.occurrenceCount || 1).toLocaleString()}
                  </div>
                  <div style="font-size:0.6875rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Occurrences</div>
                </div>
              </div>

              <div style="font-size:0.875rem;color:var(--admin-text-secondary);background:var(--admin-bg-subtle);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-family:'JetBrains Mono',monospace;word-break:break-all;line-height:1.4;">
                ${this._escape(fp.normalizedMessage || inc.title || 'No normalized message')}
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem;margin-top:0.875rem;font-size:0.8125rem;">
                <div><strong>Incident ID:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(inc.id)}</code> <button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyErrorText('${this._escape(inc.id)}', 'Incident ID')">Copy</button></div>
                <div><strong>Fingerprint Hash:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(fp.fingerprintHash ? fp.fingerprintHash.substring(0, 12) + '...' : 'N/A')}</code> <button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.inspectFingerprint('${fp.id}')">Inspect FP</button></div>
                <div><strong>First Seen:</strong> ${inc.firstSeenAt ? new Date(inc.firstSeenAt).toLocaleString() : 'N/A'}</div>
                <div><strong>Last Seen:</strong> ${inc.lastSeenAt ? new Date(inc.lastSeenAt).toLocaleString() : 'N/A'}</div>
              </div>
            </div>

            <!-- Triage & Management Actions -->
            ${canManage ? `
              <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
                <div style="font-size:0.8125rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-text-primary);">Incident Lifecycle Management</div>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                  ${inc.status === 'OPEN' ? `
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.acknowledgeIncident('${inc.id}')">
                      👁️ Acknowledge
                    </button>
                  ` : ''}

                  ${inc.status !== 'RESOLVED' ? `
                    <button class="admin-btn admin-btn-success admin-btn-sm" onclick="AdminShell.showResolveIncidentModal('${inc.id}')">
                      ✓ Resolve Incident
                    </button>
                  ` : `
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.acknowledgeIncident('${inc.id}')">
                      🔄 Reopen / Acknowledge
                    </button>
                  `}

                  ${inc.status !== 'MUTED' ? `
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.showMuteIncidentModal('${inc.id}')">
                      🔇 Mute Incident
                    </button>
                  ` : `
                    <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.confirmUnmuteIncident('${inc.id}')">
                      🔊 Unmute Incident
                    </button>
                  `}
                </div>
              </div>
            ` : ''}

            <!-- Lifecycle Details Card -->
            ${(inc.acknowledgedAt || inc.resolvedAt || inc.mutedAt) ? `
              <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;font-size:0.8125rem;">
                <div style="font-size:0.8125rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);">Audit &amp; Triage History</div>
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${inc.acknowledgedAt ? `
                    <div style="background:var(--admin-bg-subtle);border-left:3px solid var(--admin-primary);padding:0.5rem 0.75rem;border-radius:var(--radius-xs);">
                      <strong>Acknowledged</strong> by <code>${this._escape(inc.acknowledgedBy || 'Operator')}</code> at ${new Date(inc.acknowledgedAt).toLocaleString()}
                    </div>
                  ` : ''}
                  ${inc.resolvedAt ? `
                    <div style="background:var(--admin-bg-subtle);border-left:3px solid var(--admin-success);padding:0.5rem 0.75rem;border-radius:var(--radius-xs);">
                      <strong>Resolved</strong> by <code>${this._escape(inc.resolvedBy || 'Operator')}</code> at ${new Date(inc.resolvedAt).toLocaleString()}
                      ${inc.resolutionNotes ? `<div style="margin-top:0.25rem;color:var(--admin-text-secondary);font-size:0.75rem;"><strong>Notes:</strong> ${this._escape(inc.resolutionNotes)}</div>` : ''}
                    </div>
                  ` : ''}
                  ${inc.mutedAt ? `
                    <div style="background:var(--admin-bg-subtle);border-left:3px solid var(--admin-text-muted);padding:0.5rem 0.75rem;border-radius:var(--radius-xs);">
                      <strong>Muted</strong> by <code>${this._escape(inc.mutedBy || 'Operator')}</code> at ${new Date(inc.mutedAt).toLocaleString()}
                      ${inc.mutedUntil ? ` &bull; <strong>Until:</strong> ${new Date(inc.mutedUntil).toLocaleString()}` : ''}
                      ${inc.muteReason ? `<div style="margin-top:0.25rem;color:var(--admin-text-secondary);font-size:0.75rem;"><strong>Reason:</strong> ${this._escape(inc.muteReason)}</div>` : ''}
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            <!-- Recent Occurrences List -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Recent Occurrences (${occurrences.length})</div>
              </div>

              ${occurrences.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${occurrences.map(occ => `
                    <div class="admin-occurrence-card" style="display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-size:0.75rem;font-weight:600;color:var(--admin-text-primary);font-family:'JetBrains Mono',monospace;">
                          ${occ.httpMethod ? `<span style="color:var(--admin-primary);">${this._escape(occ.httpMethod)}</span> ` : ''}${this._escape(occ.httpPath || occ.rawErrorMessage?.substring(0, 50) || 'Direct Error')}
                        </div>
                        <div style="font-size:0.6875rem;color:var(--admin-text-muted);margin-top:2px;">
                          ${new Date(occ.createdAt).toLocaleString()} &bull; Req: <code>${this._escape(occ.requestId ? occ.requestId.substring(0, 8) + '...' : 'N/A')}</code>
                        </div>
                      </div>
                      <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.inspectOccurrence('${occ.id}')">
                        Inspect
                      </button>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No recent occurrence records attached to this incident.</div>
              `}
            </div>
          </div>
        `;

        this._showDrawer(`Incident: ${inc.id.substring(0, 8)}...`, html);
      } catch (err) {
        this._showDrawer('Incident Inspection Error', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    async inspectOccurrence(occurrenceId) {
      try {
        const res = await window.AdminApi.getErrorOccurrence(occurrenceId);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to fetch occurrence details');
        }

        const occ = res.data?.occurrence;
        if (!occ) throw new Error('Occurrence not found');

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <!-- Metadata Card -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Occurrence Diagnostic Profile</div>
                <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.inspectIncident('${occ.incidentId}')">
                  &larr; Back to Incident
                </button>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.8125rem;">
                <div><strong>Occurrence ID:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(occ.id)}</code> <button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyErrorText('${this._escape(occ.id)}', 'Occurrence ID')">Copy</button></div>
                <div><strong>Timestamp:</strong> ${new Date(occ.createdAt).toLocaleString()}</div>
                <div><strong>Request ID:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(occ.requestId || 'N/A')}</code> ${occ.requestId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyErrorText('${this._escape(occ.requestId)}', 'Request ID')">Copy</button>` : ''}</div>
                <div><strong>Trace / Span:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(occ.traceId || 'N/A')}</code></div>
                <div><strong>HTTP Route:</strong> <code>${this._escape(occ.httpMethod || '-')} ${this._escape(occ.httpPath || '-')}</code></div>
                <div><strong>HTTP Status:</strong> <span class="admin-badge admin-badge-${occ.httpStatusCode >= 500 ? 'danger' : 'warning'}">${this._escape(occ.httpStatusCode || '-')}</span></div>
                <div><strong>User ID:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(occ.userId || 'N/A')}</code></div>
                <div><strong>Device / Server:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(occ.deviceId || occ.serverId || 'N/A')}</code></div>
                <div><strong>Client IP:</strong> <code>${this._escape(occ.ipAddress || 'N/A')}</code></div>
                <div><strong>Client Version:</strong> <code>${this._escape(occ.clientVersion || occ.appVersion || 'N/A')}</code></div>
              </div>
            </div>

            <!-- Raw Error Message -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Raw Error Message</div>
                <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.copyErrorText('${this._escape(occ.rawErrorMessage || '')}', 'Error Message')">
                  ${ICONS.copy} Copy
                </button>
              </div>
              <div style="font-size:0.8125rem;color:var(--admin-danger);background:var(--admin-bg-subtle);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-family:'JetBrains Mono',monospace;word-break:break-all;line-height:1.4;">
                ${this._escape(occ.rawErrorMessage || 'No raw error message captured')}
              </div>
            </div>

            <!-- Sanitized Stack Trace -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Sanitized Stack Trace</div>
                ${occ.sanitizedStackTrace ? `
                  <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.copyErrorText('${this._escape(occ.sanitizedStackTrace)}', 'Stack Trace')">
                    ${ICONS.copy} Copy Stack
                  </button>
                ` : ''}
              </div>
              ${occ.sanitizedStackTrace ? `
                <pre class="admin-stack-trace-box"><code>${this._escape(occ.sanitizedStackTrace)}</code></pre>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No stack trace available for this occurrence.</div>
              `}
            </div>

            <!-- Metadata & Context JSON -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);">Sanitized Metadata &amp; Context</div>
                ${occ.sanitizedMetadata ? `
                  <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.copyErrorText('${this._escape(JSON.stringify(occ.sanitizedMetadata, null, 2))}', 'Metadata JSON')">
                    ${ICONS.copy} Copy JSON
                  </button>
                ` : ''}
              </div>
              ${occ.sanitizedMetadata ? `
                <pre class="admin-json-box"><code>${this._escape(JSON.stringify(occ.sanitizedMetadata, null, 2))}</code></pre>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No metadata captured.</div>
              `}
            </div>
          </div>
        `;

        this._showDrawer(`Occurrence: ${occ.id.substring(0, 8)}...`, html);
      } catch (err) {
        this._showDrawer('Occurrence Inspection Error', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    async inspectFingerprint(fingerprintId) {
      try {
        const res = await window.AdminApi.getErrorFingerprint(fingerprintId);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to fetch fingerprint details');
        }

        const fp = res.data?.fingerprint;
        if (!fp) throw new Error('Fingerprint not found');

        const incidents = fp.incidents || [];

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);margin-bottom:0.75rem;">Fingerprint Identity Profile</div>
              
              <div style="display:grid;grid-template-columns:1fr;gap:0.5rem;font-size:0.8125rem;">
                <div><strong>Fingerprint ID:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(fp.id)}</code></div>
                <div><strong>Hash:</strong> <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${this._escape(fp.fingerprintHash)}</code> <button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyErrorText('${this._escape(fp.fingerprintHash)}', 'Fingerprint Hash')">Copy</button></div>
                <div><strong>Component:</strong> <span class="admin-badge admin-badge-neutral">${this._escape(fp.component)}</span></div>
                <div><strong>Error Code:</strong> <code style="font-family:'JetBrains Mono',monospace;">${this._escape(fp.errorCode || 'UNKNOWN_ERROR')}</code></div>
                <div><strong>Exception Type:</strong> <code>${this._escape(fp.exceptionType || 'N/A')}</code></div>
                <div><strong>First Seen:</strong> ${fp.firstSeenAt ? new Date(fp.firstSeenAt).toLocaleString() : 'N/A'}</div>
                <div><strong>Last Seen:</strong> ${fp.lastSeenAt ? new Date(fp.lastSeenAt).toLocaleString() : 'N/A'}</div>
                <div><strong>Total Historical Occurrences:</strong> <strong>${(fp.totalOccurrences || 0).toLocaleString()}</strong></div>
              </div>

              <div style="margin-top:0.75rem;">
                <div style="font-size:0.75rem;font-weight:600;color:var(--admin-text-secondary);margin-bottom:0.25rem;">Normalized Message Pattern:</div>
                <div style="font-size:0.8125rem;background:var(--admin-bg-subtle);border-radius:var(--radius-xs);padding:0.5rem 0.75rem;font-family:'JetBrains Mono',monospace;word-break:break-all;">
                  ${this._escape(fp.normalizedMessage)}
                </div>
              </div>
            </div>

            <!-- Linked Incidents -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="font-size:0.8125rem;font-weight:700;color:var(--admin-text-primary);margin-bottom:0.75rem;">Linked Incidents (${incidents.length})</div>
              ${incidents.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${incidents.map(inc => `
                    <div class="admin-occurrence-card" style="display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="display:flex;align-items:center;gap:0.375rem;">
                          ${this._renderSeverityBadge(inc.severity)}
                          ${this._renderIncidentStatusBadge(inc.status)}
                        </div>
                        <div style="font-size:0.6875rem;color:var(--admin-text-muted);margin-top:2px;">
                          ID: <code>${this._escape(inc.id.substring(0, 8))}...</code> &bull; Updated: ${new Date(inc.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.inspectIncident('${inc.id}')">
                        Inspect
                      </button>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No incidents linked to this fingerprint.</div>
              `}
            </div>
          </div>
        `;

        this._showDrawer(`Fingerprint: ${fp.fingerprintHash.substring(0, 10)}...`, html);
      } catch (err) {
        this._showDrawer('Fingerprint Inspection Error', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    async acknowledgeIncident(incidentId) {
      try {
        const res = await window.AdminApi.acknowledgeErrorIncident(incidentId);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to acknowledge incident');
        }
        this.toast('Incident marked as ACKNOWLEDGED', 'success');
        this.inspectIncident(incidentId);
        this.loadErrorIncidents(this.errorCenterState.page);
      } catch (err) {
        this.toast(err.message, 'danger');
      }
    }

    showResolveIncidentModal(incidentId) {
      this.showConfirmModal({
        title: 'Resolve Error Incident',
        message: 'Are you sure you want to mark this incident as RESOLVED? Future identical errors will automatically reopen the incident or create a new lifecycle tracking record.',
        confirmLabel: 'Resolve Incident',
        confirmType: 'success',
        requireReason: true,
        onConfirm: async (resolutionNotes) => {
          const res = await window.AdminApi.resolveErrorIncident(incidentId, { resolutionNotes });
          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to resolve incident');
          }
          this.toast('Incident marked as RESOLVED', 'success');
          this.inspectIncident(incidentId);
          this.loadErrorIncidents(this.errorCenterState.page);
        }
      });
    }

    showMuteIncidentModal(incidentId) {
      const existing = document.getElementById('adminMuteModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminMuteModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Mute Error Incident</h3>
            <button class="admin-btn-icon" id="adminMuteCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;font-size:0.875rem;color:var(--admin-text-secondary);">
              Muting suppresses notifications and separates this incident from active alerts for a bounded duration.
            </p>
            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Mute Duration:
              </label>
              <select id="adminMuteDurationSelect" class="admin-select" style="width:100%;">
                <option value="60">1 Hour (60 minutes)</option>
                <option value="360">6 Hours</option>
                <option value="1440" selected>24 Hours (1 Day)</option>
                <option value="4320">3 Days</option>
                <option value="10080">7 Days (1 Week)</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Mute Reason (Required):
              </label>
              <input type="text" id="adminMuteReasonInput" class="admin-search-input" maxlength="255" placeholder="e.g. Known upstream dependency outage, fix in progress..." style="padding-left:0.875rem;">
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminMuteCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-primary" id="adminMuteConfirmBtn">Confirm Mute</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminMuteCloseBtn');
      const cancelBtn = document.getElementById('adminMuteCancelBtn');
      const confirmBtn = document.getElementById('adminMuteConfirmBtn');
      const reasonInput = document.getElementById('adminMuteReasonInput');
      const durationSelect = document.getElementById('adminMuteDurationSelect');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const reason = reasonInput ? reasonInput.value.trim() : '';
          if (!reason) {
            this.toast('Please provide a reason for muting this incident', 'warning');
            return;
          }
          const durationMinutes = parseInt(durationSelect ? durationSelect.value : '1440', 10);
          const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Muting...';

          try {
            const res = await window.AdminApi.muteErrorIncident(incidentId, { reason, mutedUntil });
            if (!res.success) {
              throw new Error(res.error?.message || 'Failed to mute incident');
            }
            closeModal();
            this.toast('Incident muted successfully', 'success');
            this.inspectIncident(incidentId);
            this.loadErrorIncidents(this.errorCenterState.page);
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Mute';
            this.toast(err.message || 'Operation failed', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    confirmUnmuteIncident(incidentId) {
      this.showConfirmModal({
        title: 'Unmute Error Incident',
        message: 'Are you sure you want to unmute this incident? It will return to active status and resume normal triage tracking.',
        confirmLabel: 'Unmute Incident',
        confirmType: 'primary',
        onConfirm: async () => {
          const res = await window.AdminApi.unmuteErrorIncident(incidentId);
          if (!res.success) {
            throw new Error(res.error?.message || 'Failed to unmute incident');
          }
          this.toast('Incident unmuted successfully', 'success');
          this.inspectIncident(incidentId);
          this.loadErrorIncidents(this.errorCenterState.page);
        }
      });
    }

    /* =========================================================================
       9. EMAIL OPERATIONS & ANALYTICS (Phase 13.11)
       ========================================================================= */
    _renderEmailOperationsView(container) {
      if (!window.AdminAuth.hasPermission('emails.read')) {
        this._renderForbiddenView({ id: 'email-operations', label: 'Email Operations', permission: 'emails.read' });
        return;
      }

      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Email Operations &amp; Analytics</h1>
            <p class="admin-view-subtitle">Real-time outbound email telemetry, delivery rates, failure analysis, provider distribution, and operational activity.</p>
          </div>
          <div class="admin-view-actions" style="display:flex;align-items:center;gap:0.75rem;">
            <div class="admin-btn-group" role="group" aria-label="Time period selector">
              <button class="admin-btn admin-btn-sm ${this.emailOperationsState.days === 7 ? 'admin-btn-primary' : 'admin-btn-secondary'}" id="btnEmailPeriod7d">7 Days</button>
              <button class="admin-btn admin-btn-sm ${this.emailOperationsState.days === 30 ? 'admin-btn-primary' : 'admin-btn-secondary'}" id="btnEmailPeriod30d">30 Days</button>
              <button class="admin-btn admin-btn-sm ${this.emailOperationsState.days === 90 ? 'admin-btn-primary' : 'admin-btn-secondary'}" id="btnEmailPeriod90d">90 Days</button>
            </div>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="btnRefreshEmails">
              ${ICONS.rotate} Refresh
            </button>
          </div>
        </div>

        <!-- Retention Policy Info Banner -->
        <div id="emailRetentionBanner" style="display:none;margin-bottom:1.25rem;padding:0.625rem 1rem;background-color:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.18);border-radius:6px;font-size:0.8125rem;color:var(--admin-text-muted);display:flex;align-items:center;gap:0.5rem;">
          <span style="color:var(--admin-primary);font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">${ICONS.info || 'ℹ'} Retention Policy:</span>
          <span id="emailRetentionNoticeText">Outbound email tracking records are retained for 90 days.</span>
        </div>

        <!-- Summary KPI Strip -->
        <div class="admin-summary-strip" id="emailSummaryStrip">
          <div class="admin-summary-card">
            <div class="admin-summary-label">Total Outbound</div>
            <div class="admin-summary-value" id="kpiEmailTotal">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Delivered</div>
            <div class="admin-summary-value" id="kpiEmailDelivered" style="color:var(--admin-success);">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Sent (In Flight)</div>
            <div class="admin-summary-value" id="kpiEmailSent" style="color:var(--admin-primary);">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Delivery Rate</div>
            <div class="admin-summary-value" id="kpiEmailDeliveryRate" style="color:var(--admin-success);">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Retrying / Deferred</div>
            <div class="admin-summary-value" id="kpiEmailDeferred" style="color:var(--admin-warning);">-</div>
          </div>
          <div class="admin-summary-card">
            <div class="admin-summary-label">Failed / Bounced</div>
            <div class="admin-summary-value" id="kpiEmailFailed" style="color:var(--admin-danger);">-</div>
          </div>
        </div>

        <!-- Status Breakdown Strip -->
        <div class="admin-card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;">
          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--admin-text-muted);margin-bottom:0.75rem;">
            Delivery &amp; Lifecycle Status Breakdown
          </div>
          <div id="emailStatusBreakdownPills" style="display:flex;flex-wrap:wrap;gap:0.625rem;align-items:center;">
            <div style="color:var(--admin-text-muted);font-size:0.8125rem;">Loading status breakdown...</div>
          </div>
        </div>

        <!-- Daily Trends & Distribution Grid -->
        <div class="admin-email-analytics-grid">
          <!-- Daily Email Volume Trend Chart Card -->
          <div class="admin-email-chart-card" style="grid-column:1 / -1;">
            <div class="admin-email-chart-header">
              <div class="admin-email-chart-title">
                ${ICONS.dashboard} Daily Outbound Volume Trends
              </div>
              <div class="admin-email-chart-legend">
                <span class="admin-chart-legend-item"><span class="admin-chart-legend-dot" style="background-color:#059669;"></span> Delivered</span>
                <span class="admin-chart-legend-item"><span class="admin-chart-legend-dot" style="background-color:#2563EB;"></span> Sent</span>
                <span class="admin-chart-legend-item"><span class="admin-chart-legend-dot" style="background-color:#D97706;"></span> Deferred</span>
                <span class="admin-chart-legend-item"><span class="admin-chart-legend-dot" style="background-color:#DC2626;"></span> Failed / Bounced</span>
              </div>
            </div>
            <div class="admin-chart-wrapper" id="emailTrendsChartWrapper">
              <div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--admin-text-muted);font-size:0.8125rem;">
                Loading trend data...
              </div>
            </div>
          </div>

          <!-- Source Pipeline Distribution Card -->
          <div class="admin-email-chart-card">
            <div class="admin-email-chart-header">
              <div class="admin-email-chart-title">
                ${ICONS.radio} Source Pipeline Distribution
              </div>
            </div>
            <div class="admin-dist-list" id="emailPipelineDistList">
              <div style="color:var(--admin-text-muted);font-size:0.8125rem;">Loading pipeline metrics...</div>
            </div>
          </div>

          <!-- Provider & Transport Distribution Card -->
          <div class="admin-email-chart-card">
            <div class="admin-email-chart-header">
              <div class="admin-email-chart-title">
                ${ICONS.server} Provider &amp; Transport
              </div>
            </div>
            <div class="admin-dist-list" id="emailProviderDistList">
              <div style="color:var(--admin-text-muted);font-size:0.8125rem;">Loading provider metrics...</div>
            </div>
          </div>

          <!-- Top Email Types Card -->
          <div class="admin-email-chart-card">
            <div class="admin-email-chart-header">
              <div class="admin-email-chart-title">
                ${ICONS['file-text']} Top Email Types
              </div>
            </div>
            <div class="admin-dist-list" id="emailTypesDistList">
              <div style="color:var(--admin-text-muted);font-size:0.8125rem;">Loading message types...</div>
            </div>
          </div>
        </div>

        <!-- Activity Tables: Recent Emails & Recent Failures -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(450px, 1fr));gap:1.5rem;margin-bottom:2rem;">
          <!-- Recent Emails Table Card -->
          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;">
              <h2 class="admin-card-title" style="font-size:0.9375rem;margin:0;">Recent Outbound Activity</h2>
              <span style="font-size:0.75rem;color:var(--admin-text-muted);">Latest 10 emails</span>
            </div>
            <div class="admin-card-body" style="padding:0;">
              <div class="admin-table-wrapper" id="recentEmailsTableWrapper">
                <div style="padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.8125rem;">Loading recent outbound messages...</div>
              </div>
            </div>
          </div>

          <!-- Recent Failures Table Card -->
          <div class="admin-card">
            <div class="admin-card-header" style="display:flex;justify-content:space-between;align-items:center;">
              <h2 class="admin-card-title" style="font-size:0.9375rem;margin:0;color:var(--admin-danger);">Recent Delivery Failures &amp; Retries</h2>
              <span style="font-size:0.75rem;color:var(--admin-text-muted);">Latest 10 exceptions</span>
            </div>
            <div class="admin-card-body" style="padding:0;">
              <div class="admin-table-wrapper" id="recentFailuresTableWrapper">
                <div style="padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.8125rem;">Loading failure events...</div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Attach event handlers
      const btn7d = document.getElementById('btnEmailPeriod7d');
      const btn30d = document.getElementById('btnEmailPeriod30d');
      const btn90d = document.getElementById('btnEmailPeriod90d');
      const btnRefresh = document.getElementById('btnRefreshEmails');

      if (btn7d) {
        btn7d.addEventListener('click', () => {
          this.emailOperationsState.days = 7;
          this._renderEmailOperationsView(container);
        });
      }
      if (btn30d) {
        btn30d.addEventListener('click', () => {
          this.emailOperationsState.days = 30;
          this._renderEmailOperationsView(container);
        });
      }
      if (btn90d) {
        btn90d.addEventListener('click', () => {
          this.emailOperationsState.days = 90;
          this._renderEmailOperationsView(container);
        });
      }
      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
          this.loadEmailOperationsData();
        });
      }

      this.loadEmailOperationsData();
    }

    async loadEmailOperationsData() {
      const days = this.emailOperationsState.days || 7;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      try {
        const [analyticsRes, recentRes, failuresRes] = await Promise.all([
          window.AdminApi.getEmailAnalytics({ startDate, endDate }),
          window.AdminApi.listEmails({ limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }),
          window.AdminApi.listEmails({ limit: 10, sortBy: 'createdAt', sortOrder: 'desc', status: 'FAILED' }).catch(() => null)
        ]);

        if (!analyticsRes.success) {
          throw new Error(analyticsRes.error?.message || 'Failed to fetch email analytics');
        }

        const analytics = analyticsRes.data || {};
        const kpis = analytics.kpis || {};
        const recentEmails = recentRes?.success ? (recentRes.data?.emails || recentRes.data?.items || []) : [];
        
        let recentFailures = failuresRes?.success ? (failuresRes.data?.emails || failuresRes.data?.items || []) : [];
        if (recentFailures.length === 0 && recentEmails.length > 0) {
          recentFailures = recentEmails.filter(e => ['FAILED', 'HARD_BOUNCED', 'SOFT_BOUNCED', 'BLOCKED', 'SPAM_COMPLAINT', 'DEFERRED', 'RETRYING'].includes(e.status));
        }

        this.emailOperationsState.analytics = analytics;
        this.emailOperationsState.recentEmails = recentEmails;
        this.emailOperationsState.recentFailures = recentFailures;

        // 1. Update KPI Strip
        const totalEl = document.getElementById('kpiEmailTotal');
        const deliveredEl = document.getElementById('kpiEmailDelivered');
        const sentEl = document.getElementById('kpiEmailSent');
        const rateEl = document.getElementById('kpiEmailDeliveryRate');
        const deferredEl = document.getElementById('kpiEmailDeferred');
        const failedEl = document.getElementById('kpiEmailFailed');

        if (totalEl) totalEl.textContent = (kpis.totalEmails || 0).toLocaleString();
        if (deliveredEl) deliveredEl.textContent = (kpis.deliveredCount || 0).toLocaleString();
        if (sentEl) sentEl.textContent = (kpis.sentCount || 0).toLocaleString();
        if (rateEl) {
          const rateVal = typeof kpis.deliveryRatePercent === 'number' ? kpis.deliveryRatePercent : 0;
          rateEl.textContent = `${rateVal.toFixed(1)}%`;
        }
        if (deferredEl) {
          const defCount = (kpis.deferredCount || 0) + (kpis.retryingCount || 0);
          deferredEl.textContent = defCount.toLocaleString();
        }
        if (failedEl) {
          const failCount = (kpis.failedCount || 0) + (kpis.bouncedCount || 0) + (kpis.blockedCount || 0) + (kpis.spamCount || 0);
          failedEl.textContent = failCount.toLocaleString();
        }

        // 1b. Update Retention Info Banner
        const retentionBanner = document.getElementById('emailRetentionBanner');
        const retentionNotice = document.getElementById('emailRetentionNoticeText');
        if (retentionBanner && analytics.retentionInfo) {
          const { configuredRetentionDays, isPartialData, oldestRetainedRecordAt } = analytics.retentionInfo;
          retentionBanner.style.display = 'flex';
          if (isPartialData && oldestRetainedRecordAt) {
            const oldestDateStr = new Date(oldestRetainedRecordAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            if (retentionNotice) {
              retentionNotice.innerHTML = `Showing partial data: records prior to <strong>${oldestDateStr}</strong> have been pruned under the configured <strong>${configuredRetentionDays}-day</strong> retention policy. Active in-flight deliveries are always protected.`;
            }
          } else {
            if (retentionNotice) {
              retentionNotice.innerHTML = `Email telemetry and tracking records are automatically retained for <strong>${configuredRetentionDays} days</strong>. Active in-flight queues and retries are never pruned.`;
            }
          }
        }

        // 2. Update Status Breakdown Pills
        this._renderEmailStatusBreakdown(analytics.statusDistribution || {});

        // 3. Update Trends Chart
        this._renderEmailTrendsChart(analytics.dailyTrends || []);

        // 4. Update Pipeline Distribution
        this._renderEmailPipelineDist(analytics.pipelineDistribution || {}, kpis.totalEmails || 0);

        // 5. Update Provider & Transport Distribution
        this._renderEmailProviderDist(analytics.providerDistribution || {}, analytics.transportDistribution || {}, kpis.totalEmails || 0);

        // 6. Update Top Email Types
        this._renderEmailTypesDist(analytics.topEmailTypes || [], kpis.totalEmails || 0);

        // 7. Update Tables
        this._renderRecentEmailsTable(recentEmails);
        this._renderRecentFailuresTable(recentFailures);

      } catch (err) {
        console.error('[EmailOps] Failed to load dashboard data:', err);
        const container = document.getElementById('emailTrendsChartWrapper');
        if (container) {
          container.innerHTML = `
            <div style="padding:2rem;text-align:center;color:var(--admin-danger);font-size:0.875rem;">
              <div>Failed to load email analytics: ${this._escape(err.message)}</div>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" style="margin-top:0.75rem;" onclick="AdminShell.loadEmailOperationsData()">Retry</button>
            </div>
          `;
        }
        this.toast(err.message || 'Failed to refresh email operations', 'danger');
      }
    }

    _renderEmailStatusBreakdown(statusDist) {
      const el = document.getElementById('emailStatusBreakdownPills');
      if (!el) return;

      const statuses = [
        { key: 'DELIVERED', label: 'Delivered', badgeClass: 'admin-badge-status-delivered' },
        { key: 'SENT', label: 'Sent', badgeClass: 'admin-badge-status-sent' },
        { key: 'DEFERRED', label: 'Deferred', badgeClass: 'admin-badge-status-deferred' },
        { key: 'RETRYING', label: 'Retrying', badgeClass: 'admin-badge-status-retrying' },
        { key: 'SOFT_BOUNCED', label: 'Soft Bounce', badgeClass: 'admin-badge-status-bounced' },
        { key: 'HARD_BOUNCED', label: 'Hard Bounce', badgeClass: 'admin-badge-status-bounced' },
        { key: 'BLOCKED', label: 'Blocked', badgeClass: 'admin-badge-status-blocked' },
        { key: 'SPAM_COMPLAINT', label: 'Spam', badgeClass: 'admin-badge-status-spam' },
        { key: 'FAILED', label: 'Failed', badgeClass: 'admin-badge-status-failed' },
        { key: 'PENDING', label: 'Pending', badgeClass: 'admin-badge-status-pending' }
      ];

      el.innerHTML = statuses.map(s => {
        const count = statusDist[s.key] || 0;
        return `
          <div class="admin-badge ${s.badgeClass}" style="padding:0.375rem 0.75rem;font-size:0.75rem;font-weight:600;">
            <span class="admin-status-dot"></span>
            ${s.label}: <strong style="margin-left:4px;font-family:var(--font-mono);">${count.toLocaleString()}</strong>
          </div>
        `;
      }).join('');
    }

    _renderEmailTrendsChart(dailyTrends) {
      const wrapper = document.getElementById('emailTrendsChartWrapper');
      if (!wrapper) return;

      if (!dailyTrends || dailyTrends.length === 0) {
        wrapper.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--admin-text-muted);font-size:0.8125rem;">
            No outbound email activity recorded in the selected period.
          </div>
        `;
        return;
      }

      // Calculate max daily volume for scaling
      const maxVal = Math.max(...dailyTrends.map(d => (d.total || (d.sent + d.delivered + d.failed + d.deferred)) || 1), 10);
      const svgHeight = 180;
      const barAreaHeight = 140;

      const columnsHtml = dailyTrends.map(d => {
        const total = d.total || (d.sent + d.delivered + d.failed + d.deferred) || 0;
        const delivered = d.delivered || 0;
        const sent = d.sent || 0;
        const deferred = d.deferred || 0;
        const failed = (d.failed || 0) + (d.bounced || 0);

        const totalHeightPx = Math.round((total / maxVal) * barAreaHeight);
        const deliveredHeightPx = total > 0 ? Math.round((delivered / total) * totalHeightPx) : 0;
        const sentHeightPx = total > 0 ? Math.round((sent / total) * totalHeightPx) : 0;
        const deferredHeightPx = total > 0 ? Math.round((deferred / total) * totalHeightPx) : 0;
        const failedHeightPx = total > 0 ? Math.max(totalHeightPx - deliveredHeightPx - sentHeightPx - deferredHeightPx, 0) : 0;

        const dateStr = d.date ? d.date.split('T')[0].substring(5) : '-';
        const fullDateStr = d.date ? d.date.split('T')[0] : '';

        return `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative;" title="${fullDateStr}: Total ${total} (Delivered: ${delivered}, Sent: ${sent}, Deferred: ${deferred}, Failed: ${failed})">
            <div style="font-size:0.6875rem;font-family:var(--font-mono);color:var(--admin-text-muted);margin-bottom:4px;">
              ${total > 0 ? total : ''}
            </div>
            <div style="width:100%;max-width:32px;display:flex;flex-direction:column-reverse;height:${Math.max(totalHeightPx, total > 0 ? 4 : 2)}px;border-radius:4px 4px 0 0;overflow:hidden;background:${total > 0 ? 'transparent' : 'var(--admin-bg-subtle)'};">
              ${deliveredHeightPx > 0 ? `<div style="height:${deliveredHeightPx}px;background-color:#059669;" title="Delivered: ${delivered}"></div>` : ''}
              ${sentHeightPx > 0 ? `<div style="height:${sentHeightPx}px;background-color:#2563EB;" title="Sent: ${sent}"></div>` : ''}
              ${deferredHeightPx > 0 ? `<div style="height:${deferredHeightPx}px;background-color:#D97706;" title="Deferred: ${deferred}"></div>` : ''}
              ${failedHeightPx > 0 ? `<div style="height:${failedHeightPx}px;background-color:#DC2626;" title="Failed: ${failed}"></div>` : ''}
            </div>
            <div style="font-size:0.6875rem;color:var(--admin-text-secondary);margin-top:6px;white-space:nowrap;font-family:var(--font-mono);">
              ${dateStr}
            </div>
          </div>
        `;
      }).join('');

      wrapper.innerHTML = `
        <div style="display:flex;align-items:flex-end;gap:8px;height:${svgHeight}px;padding:0.5rem 0.25rem 0;border-bottom:1px solid var(--admin-border-subtle);width:100%;">
          ${columnsHtml}
        </div>
      `;
    }

    _renderEmailPipelineDist(pipelineDist, total) {
      const el = document.getElementById('emailPipelineDistList');
      if (!el) return;

      const pipelines = [
        { key: 'OTP', label: 'Authentication OTP', color: '#2563EB' },
        { key: 'NOTIFICATION', label: 'User Notifications', color: '#059669' },
        { key: 'SYSTEM', label: 'System & Security Alerts', color: '#7C3AED' },
        { key: 'TRANSACTIONAL', label: 'Transactional Receipts', color: '#0891B2' }
      ];

      const validTotal = Math.max(total, 1);

      el.innerHTML = pipelines.map(p => {
        const count = pipelineDist[p.key] || 0;
        const pct = ((count / validTotal) * 100).toFixed(1);
        return `
          <div class="admin-dist-item">
            <div class="admin-dist-header">
              <span class="admin-dist-name">${p.label}</span>
              <span class="admin-dist-stats"><strong>${count.toLocaleString()}</strong> (${pct}%)</span>
            </div>
            <div class="admin-dist-bar-track">
              <div class="admin-dist-bar-fill" style="width:${pct}%;background-color:${p.color};"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    _renderEmailProviderDist(providerDist, transportDist, total) {
      const el = document.getElementById('emailProviderDistList');
      if (!el) return;

      const validTotal = Math.max(total, 1);

      const providers = Object.entries(providerDist).map(([k, v]) => ({
        label: `Provider: ${k}`,
        count: v,
        pct: ((v / validTotal) * 100).toFixed(1),
        color: k === 'BREVO' ? '#059669' : '#2563EB'
      }));

      const transports = Object.entries(transportDist).map(([k, v]) => ({
        label: `Transport: ${k}`,
        count: v,
        pct: ((v / validTotal) * 100).toFixed(1),
        color: k === 'BREVO_API' ? '#10B981' : '#3B82F6'
      }));

      const allItems = [...providers, ...transports];
      if (allItems.length === 0) {
        el.innerHTML = `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No provider data recorded.</div>`;
        return;
      }

      el.innerHTML = allItems.map(item => `
        <div class="admin-dist-item">
          <div class="admin-dist-header">
            <span class="admin-dist-name">${this._escape(item.label)}</span>
            <span class="admin-dist-stats"><strong>${item.count.toLocaleString()}</strong> (${item.pct}%)</span>
          </div>
          <div class="admin-dist-bar-track">
            <div class="admin-dist-bar-fill" style="width:${item.pct}%;background-color:${item.color};"></div>
          </div>
        </div>
      `).join('');
    }

    _renderEmailTypesDist(topTypes, total) {
      const el = document.getElementById('emailTypesDistList');
      if (!el) return;

      if (!topTypes || topTypes.length === 0) {
        el.innerHTML = `<div style="color:var(--admin-text-muted);font-size:0.8125rem;">No email type breakdown recorded.</div>`;
        return;
      }

      const validTotal = Math.max(total, 1);

      el.innerHTML = topTypes.slice(0, 5).map(t => {
        const typeName = t.emailType || t.type || 'UNKNOWN';
        const count = t.count || 0;
        const pct = ((count / validTotal) * 100).toFixed(1);
        return `
          <div class="admin-dist-item">
            <div class="admin-dist-header">
              <span class="admin-dist-name" style="font-family:var(--font-mono);font-size:0.75rem;">${this._escape(typeName)}</span>
              <span class="admin-dist-stats"><strong>${count.toLocaleString()}</strong> (${pct}%)</span>
            </div>
            <div class="admin-dist-bar-track">
              <div class="admin-dist-bar-fill" style="width:${pct}%;background-color:#6366F1;"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    _renderRecentEmailsTable(emails) {
      const el = document.getElementById('recentEmailsTableWrapper');
      if (!el) return;

      if (!emails || emails.length === 0) {
        el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.8125rem;">No recent outbound emails found.</div>`;
        return;
      }

      el.innerHTML = `
        <table class="admin-table" style="font-size:0.8125rem;">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Recipient</th>
              <th>Type</th>
              <th>Status</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${emails.map(e => `
              <tr>
                <td style="white-space:nowrap;color:var(--admin-text-muted);font-family:var(--font-mono);font-size:0.75rem;">
                  ${new Date(e.createdAt).toLocaleString()}
                </td>
                <td style="font-weight:500;color:var(--admin-text-primary);">
                  ${this._escape(e.recipientEmail)}
                </td>
                <td>
                  <code style="font-size:0.6875rem;padding:2px 4px;background:var(--admin-bg-subtle);border-radius:3px;">${this._escape(e.emailType)}</code>
                </td>
                <td>
                  ${this._renderEmailStatusBadge(e.status)}
                </td>
                <td style="text-align:right;">
                  <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectEmail('${this._escape(e.id)}')">
                    Inspect
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    _renderRecentFailuresTable(failures) {
      const el = document.getElementById('recentFailuresTableWrapper');
      if (!el) return;

      if (!failures || failures.length === 0) {
        el.innerHTML = `
          <div style="padding:2rem;text-align:center;color:var(--admin-success);font-size:0.8125rem;">
            ✓ No recent delivery failures or retry exceptions recorded.
          </div>
        `;
        return;
      }

      el.innerHTML = `
        <table class="admin-table" style="font-size:0.8125rem;">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Recipient</th>
              <th>Error / Reason</th>
              <th>Status</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${failures.map(e => `
              <tr>
                <td style="white-space:nowrap;color:var(--admin-text-muted);font-family:var(--font-mono);font-size:0.75rem;">
                  ${new Date(e.createdAt).toLocaleString()}
                </td>
                <td style="font-weight:500;color:var(--admin-text-primary);">
                  ${this._escape(e.recipientEmail)}
                </td>
                <td style="color:var(--admin-danger);font-size:0.75rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._escape(e.lastErrorMessage || e.status)}">
                  ${this._escape(e.lastErrorMessage || e.status)}
                </td>
                <td>
                  ${this._renderEmailStatusBadge(e.status)}
                </td>
                <td style="text-align:right;">
                  <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell.inspectEmail('${this._escape(e.id)}')">
                    Inspect
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    _renderEmailStatusBadge(status) {
      if (!status) return `<span class="admin-badge admin-badge-neutral">UNKNOWN</span>`;
      const s = String(status).toUpperCase();
      switch (s) {
        case 'DELIVERED':
          return `<span class="admin-badge admin-badge-status-delivered"><span class="admin-status-dot"></span> DELIVERED</span>`;
        case 'SENT':
          return `<span class="admin-badge admin-badge-status-sent"><span class="admin-status-dot"></span> SENT (IN FLIGHT)</span>`;
        case 'DEFERRED':
          return `<span class="admin-badge admin-badge-status-deferred"><span class="admin-status-dot"></span> DEFERRED</span>`;
        case 'RETRYING':
          return `<span class="admin-badge admin-badge-status-retrying"><span class="admin-status-dot"></span> RETRYING</span>`;
        case 'SOFT_BOUNCED':
          return `<span class="admin-badge admin-badge-status-bounced"><span class="admin-status-dot"></span> SOFT BOUNCE</span>`;
        case 'HARD_BOUNCED':
        case 'BOUNCED':
          return `<span class="admin-badge admin-badge-status-bounced"><span class="admin-status-dot"></span> HARD BOUNCE</span>`;
        case 'BLOCKED':
          return `<span class="admin-badge admin-badge-status-blocked"><span class="admin-status-dot"></span> BLOCKED</span>`;
        case 'SPAM':
        case 'SPAM_COMPLAINT':
          return `<span class="admin-badge admin-badge-status-spam"><span class="admin-status-dot"></span> SPAM</span>`;
        case 'PERMANENTLY_FAILED':
          return `<span class="admin-badge admin-badge-status-failed"><span class="admin-status-dot"></span> PERMANENTLY FAILED</span>`;
        case 'FAILED':
          return `<span class="admin-badge admin-badge-status-failed"><span class="admin-status-dot"></span> FAILED</span>`;
        case 'QUEUED':
          return `<span class="admin-badge admin-badge-status-pending"><span class="admin-status-dot"></span> QUEUED</span>`;
        case 'PENDING':
          return `<span class="admin-badge admin-badge-status-pending"><span class="admin-status-dot"></span> PENDING</span>`;
        default:
          return `<span class="admin-badge admin-badge-neutral">${this._escape(s)}</span>`;
      }
    }

    copyText(text, label = 'Text') {
      return this.copyErrorText(text, label);
    }

    _getEmailStatusMeaning(status) {
      if (!status) return 'Lifecycle state recorded in ZdexCloud database.';
      const s = String(status).toUpperCase();
      switch (s) {
        case 'DELIVERED':
          return 'Provider confirmed delivery to recipient mail server.';
        case 'SENT':
          return 'Provider accepted / send event recorded. Awaiting downstream delivery confirmation.';
        case 'DEFERRED':
          return 'Provider temporarily deferred delivery (remote mail server limit, DNS delay, or greylisting).';
        case 'RETRYING':
          return 'ZdexCloud is scheduled to retry delivery in accordance with retry backoff policy.';
        case 'SOFT_BOUNCED':
          return 'Temporary delivery failure reported by provider (mailbox full, connection timeout, etc.).';
        case 'HARD_BOUNCED':
        case 'BOUNCED':
          return 'Permanent delivery failure reported by provider (mailbox does not exist or domain rejected).';
        case 'BLOCKED':
          return 'Provider blocked delivery due to recipient domain blacklist or provider security policy.';
        case 'SPAM':
        case 'SPAM_COMPLAINT':
          return 'Provider reported a spam complaint event from the recipient mail provider.';
        case 'FAILED':
          return 'Send / delivery operation failed during dispatch.';
        case 'PERMANENTLY_FAILED':
          return 'ZdexCloud exhausted all applicable retry and fallback attempts without delivery confirmation.';
        case 'QUEUED':
          return 'Queued in ZdexCloud message store awaiting worker dispatch.';
        default:
          return 'Lifecycle state recorded in ZdexCloud database.';
      }
    }

    _getEmailStatusEvidence(email) {
      if (!email) return 'No status evidence recorded.';
      const status = String(email.status || '').toUpperCase();
      const metadata = email.metadata || {};
      const processedEvents = Array.isArray(metadata.processedEvents) ? metadata.processedEvents : [];

      if (status === 'DELIVERED' && email.deliveredAt) {
        return `Brevo transactional 'delivered' webhook received and verified at ${new Date(email.deliveredAt).toLocaleString()}.`;
      }
      if (status === 'SENT') {
        if (email.transport === 'SMTP_RELAY') {
          return `Accepted by SMTP relay server at ${email.sentAt ? new Date(email.sentAt).toLocaleString() : 'N/A'}. (Note: Provider webhook reconciliation is unavailable for SMTP-originated messages).`;
        }
        return `Accepted by Brevo REST API at ${email.sentAt ? new Date(email.sentAt).toLocaleString() : 'N/A'}. Webhook delivery event pending.`;
      }
      if (status === 'DEFERRED') {
        return `Provider deferral reported: ${email.failureReason || 'Remote MX temporary limit / greylisting'}.`;
      }
      if (status === 'RETRYING') {
        const nextTime = email.nextRetryAt ? new Date(email.nextRetryAt).toLocaleString() : 'scheduled';
        return `Retry scheduled for ${nextTime} (Attempt ${email.attemptCount || 1} of ${email.maxAttempts || 5}).`;
      }
      if (status === 'SOFT_BOUNCED' || (status === 'BOUNCED' && email.failureReason?.toLowerCase().includes('soft'))) {
        return `Soft bounce reported by provider: ${email.failureReason || 'Temporary mailbox or routing issue'}.`;
      }
      if (status === 'HARD_BOUNCED' || status === 'BOUNCED') {
        return `Hard bounce reported by provider: ${email.failureReason || 'Permanent mailbox or domain rejection'}.`;
      }
      if (status === 'BLOCKED') {
        return `Provider blocked delivery: ${email.failureReason || 'IP/domain blacklist or policy rejection'}.`;
      }
      if (status === 'SPAM' || status === 'SPAM_COMPLAINT') {
        return `Recipient ISP or user reported a spam complaint event to Brevo.`;
      }
      if (status === 'PERMANENTLY_FAILED') {
        return `Retry attempts exhausted (${email.attemptCount || 0}/${email.maxAttempts || 5}). Final error: ${email.failureReason || 'Transport error'}.`;
      }
      if (status === 'FAILED') {
        return `Operation failure: ${email.failureReason || 'Transport error recorded'}.`;
      }
      return 'State transition logged in ZdexCloud database.';
    }

    _getEmailDeliveryConfirmationState(email) {
      if (!email) return { label: 'Unknown', badgeClass: 'admin-badge-neutral', desc: 'No delivery confirmation data.' };
      const status = String(email.status || '').toUpperCase();

      if (status === 'DELIVERED' && email.deliveredAt) {
        return { label: 'Confirmed', badgeClass: 'admin-badge-success', desc: 'Recipient mail server confirmed receipt.' };
      }
      if (['BOUNCED', 'SOFT_BOUNCED', 'HARD_BOUNCED', 'BLOCKED', 'SPAM', 'SPAM_COMPLAINT', 'FAILED', 'PERMANENTLY_FAILED'].includes(status)) {
        return { label: 'Failed / Terminated', badgeClass: 'admin-badge-danger', desc: 'Delivery terminated unsuccessfully.' };
      }
      if (status === 'DEFERRED') {
        return { label: 'Temporarily Deferred', badgeClass: 'admin-badge-warning', desc: 'Recipient server temporarily deferred acceptance.' };
      }
      if (status === 'SENT') {
        return { label: 'Not Confirmed (In Flight)', badgeClass: 'admin-badge-primary', desc: 'Dispatched to provider; webhook confirmation pending.' };
      }
      if (status === 'RETRYING') {
        return { label: 'Retrying', badgeClass: 'admin-badge-warning', desc: 'Awaiting scheduled retry attempt.' };
      }
      return { label: 'Unknown / Incomplete', badgeClass: 'admin-badge-neutral', desc: 'Lifecycle is pending or incomplete.' };
    }

    _getEmailRetryCondition(email) {
      if (!email) return { label: 'None', badgeClass: 'admin-badge-neutral', desc: 'N/A' };
      const status = String(email.status || '').toUpperCase();

      if (status === 'RETRYING' || (email.nextRetryAt && new Date(email.nextRetryAt) > new Date())) {
        const timeStr = email.nextRetryAt ? new Date(email.nextRetryAt).toLocaleTimeString() : 'scheduled';
        return { label: 'Scheduled', badgeClass: 'admin-badge-warning', desc: `Next attempt at ${timeStr}` };
      }
      if (status === 'PERMANENTLY_FAILED' || (email.attemptCount >= email.maxAttempts && ['FAILED', 'BOUNCED', 'BLOCKED'].includes(status))) {
        return { label: 'Exhausted', badgeClass: 'admin-badge-danger', desc: `Consumed all ${email.attemptCount || email.maxAttempts} attempts` };
      }
      if (status === 'DELIVERED') {
        return { label: 'None', badgeClass: 'admin-badge-success', desc: 'Delivery successful; no retry required' };
      }
      if (email.sourcePipeline === 'OTP') {
        return { label: 'Not Applicable', badgeClass: 'admin-badge-neutral', desc: 'Single-shot transactional OTP delivery' };
      }
      return { label: 'None', badgeClass: 'admin-badge-neutral', desc: 'No active retry scheduled' };
    }

    _getEmailFailureClassification(email) {
      if (!email) return 'N/A';
      if (email.failureCode) return email.failureCode;
      const status = String(email.status || '').toUpperCase();
      if (status === 'DELIVERED') return 'ALREADY_DELIVERED';
      if (status === 'BLOCKED') return 'BLOCKED';
      if (status === 'SPAM' || status === 'SPAM_COMPLAINT') return 'SPAM';
      if (status === 'HARD_BOUNCED') return 'PERMANENT';
      if (status === 'PERMANENTLY_FAILED') return 'EXHAUSTED';
      if (status === 'RETRYING' || status === 'DEFERRED' || status === 'SOFT_BOUNCED') return 'RETRYABLE';
      return 'N/A';
    }

    async inspectEmail(emailId) {
      try {
        const res = await window.AdminApi.getEmail(emailId);
        if (!res.success) {
          throw new Error(res.error?.message || 'Failed to fetch email details');
        }

        const email = res.data?.email;
        if (!email) throw new Error('Email record not found');

        const attempts = email.attempts || [];
        const metadata = email.metadata || {};
        const processedEvents = Array.isArray(metadata.processedEvents) ? metadata.processedEvents : [];

        const confirmation = this._getEmailDeliveryConfirmationState(email);
        const retryCond = this._getEmailRetryCondition(email);
        const failureClass = this._getEmailFailureClassification(email);
        const statusMeaning = this._getEmailStatusMeaning(email.status);
        const statusEvidence = this._getEmailStatusEvidence(email);

        // Build Chronological Timeline Milestones
        const timelineItems = [];

        // 1. Created
        if (email.createdAt) {
          timelineItems.push({
            title: 'Message Record Created',
            time: new Date(email.createdAt).toLocaleString(),
            body: `Initialized in ZdexCloud outbound store via <strong>${this._escape(email.sourcePipeline)}</strong> pipeline.`,
            dotClass: 'primary'
          });
        }

        // 2. Queued
        if (email.queuedAt) {
          timelineItems.push({
            title: 'Enqueued for Delivery',
            time: new Date(email.queuedAt).toLocaleString(),
            body: 'Placed into asynchronous delivery worker queue.',
            dotClass: 'primary'
          });
        }

        // 3. Recorded Attempts
        attempts.forEach(att => {
          const success = att.success || att.status === 'SENT' || att.status === 'DELIVERED';
          timelineItems.push({
            title: `Send Attempt #${att.attemptNumber} (${this._escape(att.transport || email.transport)})`,
            time: new Date(att.attemptedAt || att.createdAt).toLocaleString(),
            body: `Result: <strong>${this._escape(att.status)}</strong>${att.durationMs ? ` &bull; Latency: ${att.durationMs}ms` : ''}${att.failureReason ? `<br><span style="color:var(--admin-danger);">${this._escape(att.failureReason)}</span>` : ''}`,
            dotClass: success ? 'primary' : (att.status === 'DEFERRED' ? 'warning' : 'danger')
          });
        });

        // 4. Provider Sent
        if (email.sentAt) {
          timelineItems.push({
            title: 'Provider Accepted & Dispatched',
            time: new Date(email.sentAt).toLocaleString(),
            body: `Accepted by <strong>${this._escape(email.provider)}</strong> (${this._escape(email.transport)}). Provider Msg ID: <code>${this._escape(email.providerMessageId || 'N/A')}</code>`,
            dotClass: 'primary'
          });
        }

        // 5. Webhook Events
        processedEvents.forEach(pe => {
          let dot = 'primary';
          const ev = String(pe.event || '').toLowerCase();
          if (ev === 'delivered') dot = 'success';
          else if (ev === 'deferred') dot = 'warning';
          else if (['soft_bounce', 'hard_bounce', 'blocked', 'spam', 'invalid_email', 'error'].includes(ev)) dot = 'danger';

          timelineItems.push({
            title: `Provider Webhook: ${this._escape(ev.toUpperCase())}`,
            time: pe.at ? new Date(pe.at).toLocaleString() : 'Timestamp not recorded',
            body: `Verified Brevo transactional webhook event '<code>${this._escape(pe.event)}</code>'.`,
            dotClass: dot
          });
        });

        // 6. Final State / Next Retry Milestone
        if (email.deliveredAt) {
          timelineItems.push({
            title: 'Confirmed Delivery',
            time: new Date(email.deliveredAt).toLocaleString(),
            body: 'Recipient mail server confirmed delivery receipt.',
            dotClass: 'success'
          });
        } else if (email.failedAt) {
          timelineItems.push({
            title: 'Terminal Delivery Failure',
            time: new Date(email.failedAt).toLocaleString(),
            body: `Final failure state: <strong>${this._escape(email.status)}</strong>.${email.failureReason ? ` Reason: ${this._escape(email.failureReason)}` : ''}`,
            dotClass: 'danger'
          });
        } else if (email.nextRetryAt && email.status === 'RETRYING') {
          timelineItems.push({
            title: 'Next Scheduled Retry',
            time: new Date(email.nextRetryAt).toLocaleString(),
            body: `ZdexCloud scheduled next attempt (#${(email.attemptCount || 0) + 1} of ${email.maxAttempts || 5}).`,
            dotClass: 'warning'
          });
        }

        const html = `
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <!-- Header Summary Card -->
            <div style="background:var(--admin-bg-base);border:1px solid var(--admin-border);border-radius:var(--radius-sm);padding:1rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:0.75rem;">
                <div>
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-text-muted);text-transform:uppercase;">Email Delivery Investigation</div>
                  <div style="font-family:var(--font-mono);font-size:0.875rem;font-weight:700;color:var(--admin-text-primary);margin-top:2px;display:flex;align-items:center;gap:0.5rem;">
                    <span>${this._escape(email.id)}</span>
                    <button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:1px 6px;" onclick="AdminShell.copyText('${this._escape(email.id)}', 'Message ID')">
                      ${ICONS.copy}
                    </button>
                  </div>
                </div>
                <div>${this._renderEmailStatusBadge(email.status)}</div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem;font-size:0.8125rem;border-top:1px solid var(--admin-border-subtle);padding-top:0.75rem;">
                <div><strong>Recipient:</strong> <code>${this._escape(email.recipientEmail)}</code></div>
                <div><strong>Email Type:</strong> <code>${this._escape(email.emailType)}</code></div>
                <div><strong>Pipeline:</strong> <span class="admin-badge admin-badge-neutral">${this._escape(email.sourcePipeline)}</span></div>
                <div><strong>Transport:</strong> <span class="admin-badge admin-badge-neutral">${this._escape(email.transport || '-')}</span></div>
              </div>
            </div>

            <!-- Current State Explanation -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Current State &amp; Semantic Meaning</span>
                ${this._renderEmailStatusBadge(email.status)}
              </div>
              <div style="font-size:0.8125rem;color:var(--admin-text-primary);line-height:1.5;">
                <div style="margin-bottom:0.375rem;">
                  <strong>Meaning:</strong> ${this._escape(statusMeaning)}
                </div>
                <div style="background:var(--admin-bg-subtle);padding:0.5rem 0.75rem;border-radius:var(--radius-xs);font-size:0.75rem;color:var(--admin-text-secondary);border-left:3px solid var(--admin-primary);">
                  <strong>Evidence:</strong> ${this._escape(statusEvidence)}
                </div>
              </div>
            </div>

            <!-- Delivery Diagnosis Section -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Delivery Diagnosis</span>
                <span class="admin-badge ${confirmation.badgeClass}">${this._escape(confirmation.label)}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;font-size:0.8125rem;">
                <div style="background:var(--admin-bg-surface);padding:0.625rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-text-muted);text-transform:uppercase;">Delivery Confirmation</div>
                  <div style="margin-top:2px;font-weight:600;color:var(--admin-text-primary);">${this._escape(confirmation.label)}</div>
                  <div style="font-size:0.6875rem;color:var(--admin-text-muted);margin-top:2px;">${this._escape(confirmation.desc)}</div>
                </div>

                <div style="background:var(--admin-bg-surface);padding:0.625rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-text-muted);text-transform:uppercase;">Retry Condition</div>
                  <div style="margin-top:2px;font-weight:600;color:var(--admin-text-primary);">${this._escape(retryCond.label)}</div>
                  <div style="font-size:0.6875rem;color:var(--admin-text-muted);margin-top:2px;">${this._escape(retryCond.desc)}</div>
                </div>

                <div style="background:var(--admin-bg-surface);padding:0.625rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-text-muted);text-transform:uppercase;">Failure Classification</div>
                  <div style="margin-top:2px;font-weight:600;color:var(--admin-text-primary);">
                    <code style="font-size:0.75rem;">${this._escape(failureClass)}</code>
                  </div>
                </div>

                <div style="background:var(--admin-bg-surface);padding:0.625rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);">
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-text-muted);text-transform:uppercase;">Attempts Consumed</div>
                  <div style="margin-top:2px;font-weight:600;color:var(--admin-text-primary);font-family:var(--font-mono);">
                    ${email.attemptCount || attempts.length} of ${email.maxAttempts || 5}
                  </div>
                </div>
              </div>

              ${email.failureReason || email.lastErrorMessage ? `
                <div style="margin-top:0.25rem;">
                  <div style="font-size:0.6875rem;font-weight:700;color:var(--admin-danger);text-transform:uppercase;margin-bottom:0.25rem;">Sanitized Failure Diagnostic</div>
                  <div style="font-size:0.75rem;color:var(--admin-danger);font-family:var(--font-mono);background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.2);padding:0.5rem 0.75rem;border-radius:var(--radius-xs);word-break:break-all;">
                    ${this._escape(email.failureReason || email.lastErrorMessage)}
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Chronological Lifecycle Timeline -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Chronological Lifecycle Timeline</span>
                <span style="font-size:0.6875rem;color:var(--admin-text-muted);font-weight:normal;">${timelineItems.length} milestone(s)</span>
              </div>
              <div class="admin-timeline">
                ${timelineItems.map(item => `
                  <div class="admin-timeline-item">
                    <span class="admin-timeline-dot ${item.dotClass}"></span>
                    <div class="admin-timeline-title">
                      <span>${this._escape(item.title)}</span>
                      <span class="admin-timeline-time">${item.time}</span>
                    </div>
                    <div class="admin-timeline-body">${item.body}</div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Provider Identity & Transport Details -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Provider Identity &amp; Transport</span>
                <span class="admin-badge admin-badge-neutral">${this._escape(email.transport || '-')}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem;font-size:0.8125rem;">
                <div><strong>Provider:</strong> <code>${this._escape(email.provider || 'BREVO')}</code></div>
                <div><strong>Transport:</strong> <code>${this._escape(email.transport || 'BREVO_API')}</code></div>
                <div style="grid-column:1 / -1;">
                  <strong>${email.transport === 'SMTP_RELAY' ? 'SMTP / Nodemailer Message ID:' : 'Brevo Provider Message ID:'}</strong>
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem;">
                    <code style="font-size:0.75rem;padding:0.25rem 0.5rem;background:var(--admin-bg-subtle);border-radius:4px;word-break:break-all;flex:1;">
                      ${this._escape(email.providerMessageId || 'Not recorded / Not assigned')}
                    </code>
                    ${email.providerMessageId ? `
                      <button class="admin-btn admin-btn-xs admin-btn-secondary" onclick="AdminShell.copyText('${this._escape(email.providerMessageId)}', 'Provider Message ID')">
                        ${ICONS.copy} Copy
                      </button>
                    ` : ''}
                  </div>
                  ${email.transport === 'SMTP_RELAY' ? `
                    <div style="font-size:0.6875rem;color:var(--admin-text-muted);margin-top:4px;font-style:italic;">
                      &bull; Provider webhook reconciliation is unavailable for SMTP-originated messages.
                    </div>
                  ` : ''}
                </div>
                ${email.providerResponseCode ? `
                  <div><strong>Provider Response Code:</strong> <code>${this._escape(email.providerResponseCode)}</code></div>
                ` : ''}
              </div>
            </div>

            <!-- Addressing & Sanitized Subject -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Addressing &amp; Message Properties</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem;font-size:0.8125rem;">
                <div><strong>Recipient Email:</strong> <code>${this._escape(email.recipientEmail)}</code></div>
                <div><strong>Recipient Name:</strong> ${this._escape(email.recipientName || '(Not specified)')}</div>
                <div><strong>Sender Email:</strong> <code>${this._escape(email.senderEmail || 'support@zdexcloud.com')}</code></div>
                <div><strong>Sender Name:</strong> ${this._escape(email.senderName || 'ZdexCloud')}</div>
                <div><strong>Template ID:</strong> <code>${this._escape(email.templateId || 'N/A')}</code></div>
                <div><strong>Email Type:</strong> <code>${this._escape(email.emailType)}</code></div>
                <div style="grid-column:1 / -1;">
                  <strong>Sanitized Subject Line:</strong>
                  <div style="font-size:0.8125rem;color:var(--admin-text-primary);background:var(--admin-bg-subtle);padding:0.375rem 0.5rem;border-radius:4px;margin-top:2px;">
                    ${this._escape(email.sanitizedSubject || email.subject || '(No subject)')}
                  </div>
                </div>
              </div>
            </div>

            <!-- Provider Webhook Events History & Engagement -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Provider Webhook Events &amp; Engagement</span>
                <span style="font-size:0.6875rem;color:var(--admin-text-muted);font-weight:normal;">${processedEvents.length} event(s)</span>
              </div>
              ${processedEvents.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.375rem;">
                  ${processedEvents.map(pe => `
                    <div style="background:var(--admin-bg-surface);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.5rem 0.75rem;font-size:0.75rem;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <strong>Event:</strong> <code>${this._escape(pe.event)}</code>
                      </div>
                      <div style="font-family:var(--font-mono);color:var(--admin-text-muted);">
                        ${pe.at ? new Date(pe.at).toLocaleString() : 'N/A'}
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.75rem;font-style:italic;">
                  ${email.transport === 'SMTP_RELAY' ? 'Webhook events are not applicable for SMTP relay transport.' : 'No provider webhook events received yet.'}
                </div>
              `}

              ${(metadata.openCount || metadata.clickCount) ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--admin-border-subtle);font-size:0.75rem;">
                  <div><strong>Opens:</strong> <code style="font-family:var(--font-mono);">${metadata.openCount || 0}</code> ${metadata.lastOpenedAt ? `(${new Date(metadata.lastOpenedAt).toLocaleTimeString()})` : ''}</div>
                  <div><strong>Clicks:</strong> <code style="font-family:var(--font-mono);">${metadata.clickCount || 0}</code> ${metadata.lastClickedAt ? `(${new Date(metadata.lastClickedAt).toLocaleTimeString()})` : ''}</div>
                </div>
              ` : ''}
            </div>

            <!-- Trace & Correlation Identifiers -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Trace &amp; Correlation Identifiers</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.8125rem;">
                <div>
                  <strong>Request ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.requestId || 'N/A')}</code>
                    ${email.requestId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyText('${this._escape(email.requestId)}', 'Request ID')">Copy</button>` : ''}
                  </div>
                </div>
                <div>
                  <strong>Correlation ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.correlationId || 'N/A')}</code>
                    ${email.correlationId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyText('${this._escape(email.correlationId)}', 'Correlation ID')">Copy</button>` : ''}
                  </div>
                </div>
                <div>
                  <strong>User ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.userId || 'N/A')}</code>
                    ${email.userId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyText('${this._escape(email.userId)}', 'User ID')">Copy</button>` : ''}
                  </div>
                </div>
                <div>
                  <strong>Device ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.deviceId || 'N/A')}</code>
                  </div>
                </div>
                <div>
                  <strong>Notification ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.notificationRecordId || 'N/A')}</code>
                    ${email.notificationRecordId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyText('${this._escape(email.notificationRecordId)}', 'Notification ID')">Copy</button>` : ''}
                  </div>
                </div>
                <div>
                  <strong>Delivery Record ID:</strong>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
                    <code style="font-size:0.75rem;">${this._escape(email.channelDeliveryRecordId || 'N/A')}</code>
                    ${email.channelDeliveryRecordId ? `<button class="admin-btn admin-btn-xs admin-btn-secondary" style="padding:0 4px;" onclick="AdminShell.copyText('${this._escape(email.channelDeliveryRecordId)}', 'Delivery Record ID')">Copy</button>` : ''}
                  </div>
                </div>
              </div>
            </div>

            <!-- Delivery Attempts History -->
            <div class="admin-investigation-section">
              <div class="admin-investigation-section-title">
                <span>Delivery Attempt Log (${attempts.length})</span>
              </div>
              ${attempts.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                  ${attempts.map(att => `
                    <div style="background:var(--admin-bg-surface);border:1px solid var(--admin-border);border-radius:var(--radius-xs);padding:0.625rem 0.75rem;font-size:0.8125rem;">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                        <strong>Attempt #${att.attemptNumber} &bull; ${this._escape(att.provider || email.provider)} (${this._escape(att.transport || email.transport)})</strong>
                        <span class="admin-badge admin-badge-${att.success || att.status === 'SENT' || att.status === 'DELIVERED' ? 'success' : 'danger'}">
                          <span class="admin-status-dot"></span> ${att.success || att.status === 'SENT' || att.status === 'DELIVERED' ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </div>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">
                        ${new Date(att.attemptedAt || att.createdAt).toLocaleString()} ${att.durationMs ? `&bull; Latency: ${att.durationMs}ms` : ''}
                      </div>
                      ${att.providerMessageId ? `
                        <div style="font-size:0.75rem;margin-top:2px;">Provider Msg ID: <code>${this._escape(att.providerMessageId)}</code></div>
                      ` : ''}
                      ${att.failureReason || att.errorMessage ? `
                        <div style="font-size:0.75rem;color:var(--admin-danger);margin-top:4px;font-family:var(--font-mono);word-break:break-all;">
                          ${this._escape(att.failureReason || att.errorMessage)} ${att.providerResponseCode || att.errorCode ? `(${this._escape(att.providerResponseCode || att.errorCode)})` : ''}
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="color:var(--admin-text-muted);font-size:0.8125rem;font-style:italic;">No recorded delivery attempt logs.</div>
              `}
            </div>
          </div>
        `;

        this._showDrawer(`Email Investigation: ${email.id.substring(0, 10)}...`, html);
      } catch (err) {
        this._showDrawer('Email Investigation Error', `<div style="padding:2rem;color:var(--admin-danger);text-align:center;">${this._escape(err.message)}</div>`);
      }
    }

    /* =========================================================================
       15. SQL QUERY RUNNER VIEW (Phase 15.2 - SQL Editor, 15.6 - Write Mode & 15.7 - Destructive Protection)
       ========================================================================= */
    async _renderSqlRunnerView(container) {
      const isDestructiveMode = this.sqlMode === 'DESTRUCTIVE';
      const isWriteMode = this.sqlMode === 'CONTROLLED_WRITE';
      const isReadOnly = !isWriteMode && !isDestructiveMode;

      const readOnlyTemplates = [
        { label: 'Show Tables', sql: 'SHOW TABLES;' },
        { label: 'Describe Users', sql: 'SHOW COLUMNS FROM users;' },
        { label: 'Users Schema', sql: 'SHOW CREATE TABLE users;' },
        { label: 'Users Indexes', sql: 'SHOW INDEX FROM users;' },
        { label: 'Sample Users', sql: 'SELECT id, email, status, createdAt FROM users ORDER BY createdAt DESC LIMIT 10;' },
        { label: 'Active Devices', sql: 'SELECT id, name, status, platform, lastSeenAt FROM devices ORDER BY lastSeenAt DESC LIMIT 10;' },
        { label: 'Recent Audits', sql: 'SELECT id, action, status, createdAt FROM audit_events ORDER BY createdAt DESC LIMIT 10;' },
        { label: 'Explain Query', sql: "EXPLAIN SELECT id, email FROM users WHERE status = 'ACTIVE';" }
      ];

      const writeTemplates = [
        { label: 'Update User Status', sql: "UPDATE users SET status = 'ACTIVE' WHERE email = 'user@example.com' AND status = 'PENDING_VERIFICATION';" },
        { label: 'Insert Support Note', sql: "INSERT INTO support_case_notes (id, supportCaseId, authorId, note, createdAt) VALUES (UUID(), 'case_123', 'admin_123', 'Manual resolution note.', NOW());" },
        { label: 'Update Device Platform', sql: "UPDATE devices SET platform = 'ANDROID' WHERE id = 'device_123' AND userId = 'user_123';" }
      ];

      const destructiveTemplates = [
        { label: 'Delete Support Notes', sql: "DELETE FROM support_case_notes WHERE note LIKE '%[TEST]%' AND createdAt < '2025-01-01';" },
        { label: 'Delete Stale Error Occurrences', sql: "DELETE FROM error_occurrences WHERE createdAt < '2025-01-01';" },
        { label: 'Delete Stale Delivery Attempts', sql: "DELETE FROM email_delivery_attempts WHERE status = 'FAILED' AND createdAt < '2025-01-01';" },
        { label: 'Delete Disconnected Sessions', sql: "DELETE FROM device_connections WHERE status = 'DISCONNECTED' AND endedAt < '2025-01-01';" }
      ];

      const templates = isDestructiveMode ? destructiveTemplates : (isWriteMode ? writeTemplates : readOnlyTemplates);

      container.innerHTML = `
        <div class="admin-sql-container">
          <div class="admin-view-header">
            <div class="admin-view-title-wrap">
              <h1>SQL Console</h1>
              <p>Super-Admin SQL Console with strict read/write/destructive safety guards, transactional row bounding &amp; immutable audit logging.</p>
            </div>
            <div class="admin-header-actions" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <!-- Mode Selector -->
              <div class="admin-sql-mode-selector">
                <button id="adminSqlModeReadOnlyBtn" type="button" class="admin-sql-mode-btn ${isReadOnly ? 'active' : ''}" onclick="AdminShell._setSqlMode('READ_ONLY')">
                  ${ICONS.shield || ''} Read-Only
                </button>
                <button id="adminSqlModeWriteBtn" type="button" class="admin-sql-mode-btn ${isWriteMode ? 'active warning' : ''}" onclick="AdminShell._promptControlledWriteMode()">
                  ${ICONS['alert-triangle'] || '⚠️'} Controlled Write
                </button>
                <button id="adminSqlModeDestructiveBtn" type="button" class="admin-sql-mode-btn ${isDestructiveMode ? 'active danger' : ''}" style="${isDestructiveMode ? 'background:#ef4444;color:#fff;border-color:#dc2626;' : ''}" onclick="AdminShell._promptDestructiveMode()">
                  ${ICONS['trash-2'] || '🗑️'} Destructive
                </button>
              </div>

              <span id="adminSqlStatusBadge" class="admin-sql-status-pill idle">
                <span class="admin-status-dot"></span> IDLE
              </span>
              <span class="admin-badge ${isDestructiveMode ? 'admin-badge-danger' : (isWriteMode ? 'admin-badge-warning' : 'admin-badge-success')}" style="font-family:var(--font-mono);font-size:0.75rem;padding:0.35rem 0.6rem;">
                <span class="admin-status-dot ${isDestructiveMode ? 'red' : (isWriteMode ? 'amber' : 'green')}"></span> ${isDestructiveMode ? 'DESTRUCTIVE MODE' : (isWriteMode ? 'CONTROLLED WRITE MODE' : 'READ-ONLY ENFORCED')}
              </span>
            </div>
          </div>

          <!-- Policy & Safety Banner -->
          <div id="adminSqlPolicyBanner" class="${isDestructiveMode ? 'admin-banner-danger' : (isWriteMode ? 'admin-banner-warning' : 'admin-banner-info')}" style="padding:0.75rem 1.25rem;border-radius:var(--radius-sm);background:${isDestructiveMode ? 'rgba(239,68,68,0.08)' : (isWriteMode ? 'rgba(245,158,11,0.08)' : 'rgba(37,99,235,0.06)')};border:1px solid ${isDestructiveMode ? 'rgba(239,68,68,0.3)' : (isWriteMode ? 'rgba(245,158,11,0.3)' : 'rgba(37,99,235,0.2)')};font-size:0.8125rem;color:var(--admin-text-primary);display:flex;align-items:center;gap:0.75rem;">
            <span style="color:${isDestructiveMode ? '#dc2626' : (isWriteMode ? '#d97706' : 'var(--admin-primary)')};display:flex;align-items:center;">
              ${isDestructiveMode ? (ICONS['trash-2'] || '🗑️') : (isWriteMode ? (ICONS['alert-triangle'] || '⚠️') : (ICONS.shield || ''))}
            </span>
            <div>
              ${isDestructiveMode
                ? '<strong>Destructive Mode Active:</strong> Permitted statements: <code>DELETE FROM table WHERE ...</code> (single-statement with mandatory non-trivial <code>WHERE</code> strictly on approved operational leaf tables with zero foreign-key dependents). Direct DELETE affected-row ceiling (max 50 rows) with automatic rollback. TRUNCATE, DROP, ALTER, non-leaf, business-sensitive (financial/billing), and protected tables are strictly prohibited.'
                : (isWriteMode
                  ? '<strong>Controlled Write Mode Active:</strong> Permitted statements: <code>INSERT</code>, <code>UPDATE</code> (with mandatory non-trivial <code>WHERE</code>). Max 50 rows modified per transaction with automatic rollback. Protected system tables and sensitive columns are guarded.'
                  : '<strong>Security Policy:</strong> Permitted statements: <code>SELECT</code>, <code>WITH ... SELECT</code>, <code>SHOW</code>, <code>DESCRIBE</code>, <code>EXPLAIN</code>. Mutations (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE), multi-statements, and OUTFILE exports are strictly blocked. Max 500 rows returned. 5,000ms query timeout.'
                )
              }
            </div>
          </div>

          <!-- Safe Template Chips Bar -->
          <div style="display:flex;flex-direction:column;gap:0.375rem;">
            <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--admin-text-muted);">
              ${isDestructiveMode ? 'Destructive Delete Templates' : (isWriteMode ? 'Controlled Write Templates' : 'Quick Query Templates')}
            </div>
            <div class="admin-sql-templates-bar">
              ${templates.map(t => `
                <button type="button" class="admin-sql-template-chip" onclick="AdminShell._applySqlTemplate('${this._escape(t.sql.replace(/'/g, "\\'"))}')">
                  ${ICONS.code || ''} ${this._escape(t.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Professional SQL Editor Component -->
          <div class="admin-sql-editor-wrapper">
            <div class="admin-sql-editor-header">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <strong>SQL Query Editor</strong>
                <span style="font-size:0.75rem;color:var(--admin-text-muted);">(MySQL 8.0 Dialect &bull; ${isDestructiveMode ? 'Destructive Mode' : (isWriteMode ? 'Write Mode' : 'Read-Only Mode')})</span>
              </div>
              <div style="font-size:0.75rem;color:var(--admin-text-muted);">
                Run: <kbd style="background:var(--admin-bg-surface);border:1px solid var(--admin-border);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);">Ctrl + Enter</kbd> &bull; Indent: <kbd style="background:var(--admin-bg-surface);border:1px solid var(--admin-border);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);">Tab</kbd>
              </div>
            </div>

            <div class="admin-sql-editor-body">
              <div id="adminSqlGutter" class="admin-sql-gutter" aria-hidden="true">1</div>
              <textarea id="adminSqlQueryInput" 
                class="admin-sql-textarea"
                rows="7" 
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                placeholder="${isDestructiveMode ? "DELETE FROM support_case_notes WHERE note LIKE '%[TEST]%' AND createdAt < '2025-01-01';" : (isWriteMode ? "UPDATE users SET status = 'ACTIVE' WHERE email = 'user@example.com';" : 'SELECT id, email, status, createdAt FROM users ORDER BY createdAt DESC LIMIT 10;')}" 
              >${isDestructiveMode ? "DELETE FROM support_case_notes WHERE note LIKE '%[TEST]%' AND createdAt < '2025-01-01';" : (isWriteMode ? "UPDATE users SET status = 'ACTIVE' WHERE email = 'user@example.com' AND status = 'PENDING_VERIFICATION';" : 'SELECT id, email, status, createdAt FROM users ORDER BY createdAt DESC LIMIT 10;')}</textarea>
            </div>

            <div class="admin-sql-meta-bar">
              <div id="adminSqlCursorPos">Line 1, Col 1</div>
              <div id="adminSqlMetaCount">1 line &bull; 78 characters</div>
            </div>
          </div>

          <!-- Editor Actions Toolbar -->
          <div class="admin-sql-toolbar">
            <div class="admin-sql-toolbar-left">
              ${isDestructiveMode ? `
                <button id="adminSqlRunBtn" class="admin-btn admin-btn-danger" type="button" onclick="AdminShell._openExecuteDestructiveModal()">
                  ${ICONS['trash-2'] || ICONS['alert-triangle']} <span>Execute Delete</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>
                </button>
              ` : (isWriteMode ? `
                <button id="adminSqlRunBtn" class="admin-btn admin-btn-warning" type="button" onclick="AdminShell._openExecuteWriteModal()">
                  ${ICONS['alert-triangle'] || ICONS['play']} <span>Execute Write</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>
                </button>
              ` : `
                <button id="adminSqlRunBtn" class="admin-btn admin-btn-primary" type="button" onclick="AdminShell._executeSqlQuery()">
                  ${ICONS['play']} <span>Execute Query</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>
                </button>
              `)}
              <button id="adminSqlSaveBtn" class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._openSaveQueryModal()" title="Save current SQL query definition for future reuse">
                ${ICONS['file-text'] || ''} Save Query
              </button>
              <button id="adminSqlFormatBtn" class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._formatSqlQuery()" title="Format SQL keywords and indentation">
                ${ICONS.code || ''} Format SQL
              </button>
              <button id="adminSqlCopyBtn" class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._copySqlQuery()" title="Copy SQL statement to clipboard">
                ${ICONS['copy']} Copy SQL
              </button>
              <button id="adminSqlClearBtn" class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._clearSqlQuery()" title="Clear SQL editor">
                ${ICONS['trash-2'] || ''} Clear
              </button>
            </div>
            <div class="admin-sql-toolbar-right">
              ${isDestructiveMode ? `
                <span class="admin-badge admin-badge-danger" style="font-size:0.75rem;font-family:var(--font-mono);">MAX 50 DELETIONS</span>
                <span class="admin-badge admin-badge-danger" style="font-size:0.75rem;font-family:var(--font-mono);">AUTO ROLLBACK</span>
                <span class="admin-badge admin-badge-danger" style="font-size:0.75rem;font-family:var(--font-mono);">WHERE ENFORCED</span>
              ` : (isWriteMode ? `
                <span class="admin-badge admin-badge-warning" style="font-size:0.75rem;font-family:var(--font-mono);">MAX 50 ROWS</span>
                <span class="admin-badge admin-badge-warning" style="font-size:0.75rem;font-family:var(--font-mono);">AUTO ROLLBACK</span>
                <span class="admin-badge admin-badge-warning" style="font-size:0.75rem;font-family:var(--font-mono);">WHERE ENFORCED</span>
              ` : `
                <span class="admin-badge admin-badge-info" style="font-size:0.75rem;font-family:var(--font-mono);">MAX 500 ROWS</span>
                <span class="admin-badge admin-badge-info" style="font-size:0.75rem;font-family:var(--font-mono);">5,000MS TIMEOUT</span>
                <span class="admin-badge admin-badge-info" style="font-size:0.75rem;font-family:var(--font-mono);">AST SAFEGUARD</span>
              `)}
            </div>
          </div>

          <!-- Query Results / Output Container -->
          <div id="adminSqlResultsWrap">
            <div class="admin-card" style="padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);border:1px dashed var(--admin-border);border-radius:var(--radius-md);">
              <div style="font-size:1.5rem;margin-bottom:0.5rem;opacity:0.6;">${ICONS.database || '⚡'}</div>
              <h4 style="margin:0 0 0.25rem 0;color:var(--admin-text-secondary);font-size:0.9375rem;">${isDestructiveMode ? 'Destructive Delete Console Ready' : (isWriteMode ? 'Controlled Write Console Ready' : 'Query Console Ready')}</h4>
              <p style="margin:0;font-size:0.8125rem;">${isDestructiveMode ? 'Write or select a DELETE statement above and click <strong>Execute Delete</strong>.' : (isWriteMode ? 'Write or select an INSERT or UPDATE statement above and click <strong>Execute Write</strong>.' : 'Write or select a read-only SQL query above and click <strong>Execute Query</strong> or press <kbd style="background:var(--admin-bg-subtle);padding:1px 5px;border-radius:3px;">Ctrl+Enter</kbd>.')}</p>
            </div>
          </div>

          <!-- Saved Queries Section (Phase 15.5) -->
          <div id="adminSqlSavedQueriesWrap" style="margin-top:1.5rem;"></div>

          <!-- Query History Section (Phase 15.4) -->
          <div id="adminSqlHistoryWrap" style="margin-top:1.5rem;"></div>
        </div>
      `;

      const input = document.getElementById('adminSqlQueryInput');
      const gutter = document.getElementById('adminSqlGutter');

      if (input) {
        // Initial line gutter & counts
        this._updateSqlEditorGutter();
        this._updateSqlCursorPos();

        // Synchronize scrolling between textarea and line numbers gutter
        input.addEventListener('scroll', () => {
          if (gutter) gutter.scrollTop = input.scrollTop;
        });

        // Input & key listeners
        input.addEventListener('input', () => {
          this._updateSqlEditorGutter();
          this._updateSqlCursorPos();
        });

        input.addEventListener('click', () => {
          this._updateSqlCursorPos();
        });

        input.addEventListener('keyup', () => {
          this._updateSqlCursorPos();
        });

        input.addEventListener('keydown', (e) => {
          // Tab key indentation handling (insert 2 spaces)
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const val = input.value;
            input.value = val.substring(0, start) + '  ' + val.substring(end);
            input.selectionStart = input.selectionEnd = start + 2;
            this._updateSqlEditorGutter();
            this._updateSqlCursorPos();
            return;
          }

          // Ctrl+Enter or Cmd+Enter execution
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (this.sqlMode === 'DESTRUCTIVE') {
              this._openExecuteDestructiveModal();
            } else if (this.sqlMode === 'CONTROLLED_WRITE') {
              this._openExecuteWriteModal();
            } else {
              this._executeSqlQuery();
            }
          }
        });
      }

      if (this.sqlResultState && this.sqlResultState.hasExecuted) {
        this._renderSqlResults();
        this._updateSqlStatusBadge('success', 'SUCCESS', `${this.sqlResultState.totalCount} rows, ${this.sqlResultState.executionTimeMs}ms`);
      }

      this._loadSqlSavedQueries();
      this._renderSqlSavedQueries();

      this._loadSqlHistory();
      this._renderSqlHistory();
    }

    _updateSqlEditorGutter() {
      const input = document.getElementById('adminSqlQueryInput');
      const gutter = document.getElementById('adminSqlGutter');
      const metaCount = document.getElementById('adminSqlMetaCount');
      if (!input || !gutter) return;

      const lines = input.value.split('\n');
      const lineCount = lines.length;
      let gutterHtml = '';
      for (let i = 1; i <= lineCount; i++) {
        gutterHtml += i + '<br>';
      }
      gutter.innerHTML = gutterHtml;
      gutter.scrollTop = input.scrollTop;

      if (metaCount) {
        const charCount = input.value.length;
        metaCount.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'} \u2022 ${charCount} character${charCount === 1 ? '' : 's'}`;
      }
    }

    _updateSqlCursorPos() {
      const input = document.getElementById('adminSqlQueryInput');
      const posEl = document.getElementById('adminSqlCursorPos');
      if (!input || !posEl) return;

      const selStart = input.selectionStart || 0;
      const textBefore = input.value.substring(0, selStart);
      const lines = textBefore.split('\n');
      const curLine = lines.length;
      const curCol = lines[lines.length - 1].length + 1;

      posEl.textContent = `Line ${curLine}, Col ${curCol}`;
    }

    _applySqlTemplate(sql) {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input) return;

      input.value = sql;
      this._updateSqlEditorGutter();
      this._updateSqlCursorPos();
      input.focus();
      this.toast('Template loaded into editor', 'info', 2000);
    }

    _copySqlQuery() {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input || !input.value.trim()) {
        this.toast('No SQL query to copy.', 'warning');
        return;
      }
      navigator.clipboard.writeText(input.value.trim()).then(() => {
        this.toast('SQL statement copied to clipboard.', 'success');
      }).catch(() => {
        this.toast('Failed to copy to clipboard.', 'danger');
      });
    }

    _clearSqlQuery() {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input) return;
      input.value = '';
      this._updateSqlEditorGutter();
      this._updateSqlCursorPos();
      this._updateSqlStatusBadge('idle', 'IDLE');
      input.focus();
    }

    _formatSqlQuery() {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input || !input.value.trim()) return;

      let sql = input.value;

      // Safe client-side keyword uppercase formatter (outside string literals)
      const keywords = [
        'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
        'LIKE', 'IS', 'NULL', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
        'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'CROSS JOIN',
        'ON', 'AS', 'UNION', 'ALL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'SHOW', 'TABLES', 'COLUMNS', 'CREATE TABLE', 'INDEX', 'STATUS', 'VARIABLES',
        'DATABASES', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH', 'ASC', 'DESC', 'COUNT',
        'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NOW', 'UTC_TIMESTAMP'
      ];

      // Tokenize strings to protect them from formatting
      const stringLiterals = [];
      sql = sql.replace(/'(?:''|\\'|[^'])*'|"(?:""|\\"|[^"])*"|`(?:``|\\`|[^`])*`/g, (match) => {
        const placeholder = `__SQL_STR_TOKEN_${stringLiterals.length}__`;
        stringLiterals.push(match);
        return placeholder;
      });

      // Capitalize keywords with boundary checks
      keywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        sql = sql.replace(regex, kw);
      });

      // Restore string literals
      stringLiterals.forEach((literal, idx) => {
        sql = sql.replace(`__SQL_STR_TOKEN_${idx}__`, literal);
      });

      input.value = sql.trim();
      this._updateSqlEditorGutter();
      this._updateSqlCursorPos();
      this.toast('SQL formatted', 'success', 2000);
    }

    _updateSqlStatusBadge(state, label, extra = '') {
      const badge = document.getElementById('adminSqlStatusBadge');
      if (!badge) return;

      badge.className = `admin-sql-status-pill ${state.toLowerCase()}`;
      let dotClass = '';
      if (state === 'running') dotClass = 'blue';
      else if (state === 'success') dotClass = 'green';
      else if (state === 'rejected') dotClass = 'amber';
      else if (state === 'error' || state === 'timeout') dotClass = 'red';

      badge.innerHTML = `<span class="admin-status-dot ${dotClass}"></span> ${label}${extra ? ` (${extra})` : ''}`;
    }

    _populateSqlCell(td, val, rowIdx, col) {
      if (val === null || val === undefined) {
        const span = document.createElement('span');
        span.className = 'admin-sql-null-val';
        span.textContent = 'NULL';
        td.appendChild(span);
        return;
      }

      if (typeof val === 'boolean') {
        const span = document.createElement('span');
        span.className = `admin-sql-bool-val ${val ? 'true' : 'false'}`;
        span.textContent = val ? 'TRUE' : 'FALSE';
        td.appendChild(span);
        return;
      }

      if (typeof val === 'number') {
        const span = document.createElement('span');
        span.className = 'admin-sql-num-val';
        span.textContent = String(val);
        td.appendChild(span);
        return;
      }

      if (typeof val === 'string') {
        if (val.includes('[REDACTED_SENSITIVE_DATA]') || val.startsWith('[REDACTED_')) {
          const span = document.createElement('span');
          span.className = 'admin-sql-redacted-val';
          span.title = 'Sensitive value masked by backend security policy';
          span.textContent = val.startsWith('[REDACTED_') && !val.includes('DATA') ? val : 'REDACTED';
          td.appendChild(span);
          return;
        }

        if (val.includes('[TRUNCATED_64KB_LIMIT]') || val.startsWith('[TRUNCATED_')) {
          const span = document.createElement('span');
          span.className = 'admin-sql-cell-truncated-val';
          span.title = 'Cell content truncated at 64KB backend limit';
          span.textContent = 'TRUNCATED (64KB)';
          td.appendChild(span);
          return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'admin-sql-cell-content';

        const isDate = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(val);
        const span = document.createElement('span');
        span.className = isDate ? 'admin-sql-date-val' : 'admin-sql-cell-text';
        span.title = isDate ? `Timestamp: ${val}` : val;
        span.textContent = val;
        wrap.appendChild(span);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'admin-sql-cell-copy-btn';
        copyBtn.title = 'Copy cell value';
        copyBtn.innerHTML = ICONS['copy'] || '📋';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._copySqlCellValue(rowIdx, col);
        });
        wrap.appendChild(copyBtn);

        td.appendChild(wrap);
        return;
      }

      if (typeof val === 'object') {
        const jsonStr = JSON.stringify(val);
        const preview = jsonStr.length > 35 ? jsonStr.substring(0, 35) + '...' : jsonStr;

        const wrap = document.createElement('div');
        wrap.className = 'admin-sql-cell-content';

        const code = document.createElement('code');
        code.className = 'admin-sql-json-badge';
        code.title = 'Click to inspect formatted JSON structure';
        code.textContent = `{JSON} ${preview}`;
        code.addEventListener('click', () => {
          this._inspectSqlCellValue(rowIdx, col);
        });
        wrap.appendChild(code);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'admin-sql-cell-copy-btn';
        copyBtn.title = 'Copy JSON value';
        copyBtn.innerHTML = ICONS['copy'] || '📋';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._copySqlCellValue(rowIdx, col);
        });
        wrap.appendChild(copyBtn);

        td.appendChild(wrap);
        return;
      }

      const span = document.createElement('span');
      span.className = 'admin-sql-cell-text';
      span.textContent = String(val);
      td.appendChild(span);
    }

    _inspectSqlCellValue(rowIdx, col) {
      const row = this.sqlResultState.rows[rowIdx];
      if (!row) return;

      const val = row[col];
      const prettyJson = typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : String(val);

      const container = document.createElement('div');
      container.style.cssText = 'display:flex;flex-direction:column;gap:1rem;';

      const topBar = document.createElement('div');
      topBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-bottom:0.75rem;border-bottom:1px solid var(--admin-border-subtle);';

      const labelWrap = document.createElement('div');
      const colBadge = document.createElement('span');
      colBadge.className = 'admin-badge admin-badge-info';
      colBadge.style.fontFamily = 'var(--font-mono)';
      colBadge.textContent = col;
      labelWrap.appendChild(colBadge);

      const rowSpan = document.createElement('span');
      rowSpan.style.cssText = 'font-size:0.8125rem;color:var(--admin-text-muted);margin-left:0.5rem;';
      rowSpan.textContent = `Row #${rowIdx + 1}`;
      labelWrap.appendChild(rowSpan);
      topBar.appendChild(labelWrap);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
      copyBtn.innerHTML = `${ICONS['copy'] || '📋'} Copy Value`;
      copyBtn.addEventListener('click', () => this._copySqlCellValue(rowIdx, col));
      topBar.appendChild(copyBtn);
      container.appendChild(topBar);

      const bodySection = document.createElement('div');
      const heading = document.createElement('h4');
      heading.style.cssText = 'font-size:0.8125rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);text-transform:uppercase;letter-spacing:0.05em;';
      heading.textContent = 'Formatted Cell Content';
      bodySection.appendChild(heading);

      const pre = document.createElement('pre');
      pre.style.cssText = 'background:var(--admin-bg-base);padding:1rem;border-radius:var(--radius-sm);border:1px solid var(--admin-border);font-family:var(--font-mono);font-size:0.8125rem;overflow-x:auto;max-height:380px;white-space:pre-wrap;word-break:break-all;';
      pre.textContent = prettyJson;
      bodySection.appendChild(pre);

      container.appendChild(bodySection);

      this._showDrawer(`Inspect Cell: ${col} (Row #${rowIdx + 1})`, container);
    }

    _copySqlCellValue(rowIdx, col) {
      const row = this.sqlResultState.rows[rowIdx];
      if (!row) return;

      const val = row[col];
      let strVal = '';
      if (val === null || val === undefined) {
        strVal = 'NULL';
      } else if (typeof val === 'object') {
        strVal = JSON.stringify(val, null, 2);
      } else {
        strVal = String(val);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(strVal).then(() => {
          this.toast(`Copied cell [${col}] to clipboard`, 'success', 2000);
        }).catch(() => {
          this.toast('Failed to copy to clipboard', 'danger');
        });
      } else {
        this.toast('Clipboard API unavailable in this browser context', 'warning');
      }
    }

    _copySqlRowAsJson(rowIdx) {
      const row = this.sqlResultState.rows[rowIdx];
      if (!row) return;

      const jsonStr = JSON.stringify(row, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(jsonStr).then(() => {
          this.toast(`Copied Row #${rowIdx + 1} as JSON to clipboard`, 'success', 2500);
        }).catch(() => {
          this.toast('Failed to copy row to clipboard', 'danger');
        });
      } else {
        this.toast('Clipboard API unavailable', 'warning');
      }
    }

    _copySqlResultsAsJson() {
      try {
        const rows = this.sqlResultState.filteredRows && this.sqlResultState.filteredRows.length > 0 
          ? this.sqlResultState.filteredRows 
          : this.sqlResultState.rows;

        if (!rows || rows.length === 0) {
          this.toast('No rows available to copy as JSON', 'warning');
          return;
        }

        const jsonStr = JSON.stringify(rows, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonStr).then(() => {
            this.toast(`Copied ${rows.length} rows as JSON to clipboard`, 'success');
          }).catch(() => {
            this.toast('Failed to copy JSON results', 'danger');
          });
        } else {
          this.toast('Clipboard API unavailable', 'warning');
        }
      } catch (err) {
        this.toast('Failed to serialize results as JSON', 'danger');
      }
    }

    _copySqlResultsAsCsv() {
      try {
        const rows = this.sqlResultState.filteredRows && this.sqlResultState.filteredRows.length > 0 
          ? this.sqlResultState.filteredRows 
          : this.sqlResultState.rows;
        const columns = this.sqlResultState.columns;

        if (!rows || rows.length === 0 || !columns || columns.length === 0) {
          this.toast('No rows available to export as CSV', 'warning');
          return;
        }

        const escapeCsvCell = (val) => {
          if (val === null || val === undefined) return '';
          let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
            str = '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        };

        const headerLine = columns.map(c => escapeCsvCell(c)).join(',');
        const rowLines = rows.map(r => columns.map(col => escapeCsvCell(r[col])).join(','));
        const csvContent = [headerLine, ...rowLines].join('\r\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(csvContent).then(() => {
            this.toast(`Copied ${rows.length} rows as CSV to clipboard`, 'success');
          }).catch(() => {
            this.toast('Failed to copy CSV results', 'danger');
          });
        } else {
          this.toast('Clipboard API unavailable', 'warning');
        }
      } catch (err) {
        this.toast('Failed to generate CSV results', 'danger');
      }
    }

    _filterSqlResults(query) {
      const q = (query || '').trim().toLowerCase();
      this.sqlResultState.filterText = q;

      if (!q) {
        this.sqlResultState.filteredRows = this.sqlResultState.rows;
      } else {
        this.sqlResultState.filteredRows = this.sqlResultState.rows.filter(row => {
          return this.sqlResultState.columns.some(col => {
            const val = row[col];
            if (val === null || val === undefined) return false;
            const strVal = typeof val === 'object' ? JSON.stringify(val).toLowerCase() : String(val).toLowerCase();
            return strVal.includes(q);
          });
        });
      }

      this._renderSqlResultsTableBody();
      this._updateSqlResultsCountHeader();
    }

    _updateSqlResultsCountHeader() {
      const countEl = document.getElementById('adminSqlResultsCountTitle');
      if (!countEl) return;

      const total = this.sqlResultState.totalCount;
      const visible = this.sqlResultState.filteredRows.length;
      const filter = this.sqlResultState.filterText;
      const truncated = this.sqlResultState.truncated;

      if (truncated) {
        if (!filter) {
          countEl.textContent = `Results — ${total}+ loaded rows (truncated)`;
        } else {
          countEl.textContent = `Results — ${visible} of ${total}+ loaded rows`;
        }
      } else {
        if (!filter) {
          countEl.textContent = `Results — ${total} row${total === 1 ? '' : 's'}`;
        } else {
          countEl.textContent = `Results — ${visible} of ${total} returned rows`;
        }
      }
    }

    _renderSqlResultsTableBody() {
      const tbody = document.getElementById('adminSqlResultTableBody');
      if (!tbody) return;

      tbody.textContent = '';

      const rows = this.sqlResultState.filteredRows;
      const columns = this.sqlResultState.columns;
      const total = this.sqlResultState.totalCount;
      const filter = this.sqlResultState.filterText;

      if (total === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = Math.max(columns.length + 1, 2);
        td.style.cssText = 'padding:2.5rem;text-align:center;color:var(--admin-text-muted);';
        td.textContent = 'Query executed successfully. 0 rows returned.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      if (rows.length === 0 && filter) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = Math.max(columns.length + 1, 2);
        td.style.cssText = 'padding:2.5rem;text-align:center;color:var(--admin-text-muted);';
        td.textContent = `No matching rows found for query filter "${filter}" among loaded results.`;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      rows.forEach((r) => {
        const originalIdx = this.sqlResultState.rows.indexOf(r);
        const displayIdx = originalIdx >= 0 ? originalIdx : 0;

        const tr = document.createElement('tr');

        // Row Index column (#)
        const tdIdx = document.createElement('td');
        tdIdx.className = 'row-idx-col';
        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'admin-sql-row-copy-btn';
        rowBtn.title = `Copy row #${displayIdx + 1} as JSON`;
        rowBtn.textContent = String(displayIdx + 1);
        rowBtn.addEventListener('click', () => this._copySqlRowAsJson(displayIdx));
        tdIdx.appendChild(rowBtn);
        tr.appendChild(tdIdx);

        // Data cells
        columns.forEach(col => {
          const td = document.createElement('td');
          this._populateSqlCell(td, r[col], displayIdx, col);
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });
    }

    _renderSqlResults() {
      const resultsWrap = document.getElementById('adminSqlResultsWrap');
      if (!resultsWrap) return;

      const { columns, totalCount, executionTimeMs, statementType, truncated, filterText } = this.sqlResultState;

      resultsWrap.innerHTML = `
        <div class="admin-sql-results-card">
          ${truncated ? `
            <div class="admin-sql-warning-banner">
              <span style="display:flex;align-items:center;">${ICONS['alert-triangle'] || '⚠️'}</span>
              <div><strong>Result Set Truncated:</strong> Query matched more than the maximum returned limit (500 rows). Only the first 500 rows were loaded into the console.</div>
            </div>
          ` : ''}

          <div class="admin-sql-results-header">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <h3 id="adminSqlResultsCountTitle" style="margin:0;font-size:0.9375rem;font-weight:700;color:var(--admin-text-primary);">
                Results — ${truncated ? `${totalCount}+ loaded rows (truncated)` : `${totalCount} row${totalCount === 1 ? '' : 's'}`}
              </h3>
              <span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);font-size:0.75rem;">
                ${this._escape(statementType)}
              </span>
              <span style="font-size:0.8125rem;color:var(--admin-text-secondary);font-family:var(--font-mono);">
                Execution Time: <strong>${executionTimeMs}ms</strong>
              </span>
            </div>

            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <!-- Client-Side Search / Filter Box -->
              <div class="admin-sql-search-box">
                ${ICONS.search || ''}
                <input type="text" id="adminSqlResultSearchInput" class="admin-sql-search-input" placeholder="Filter loaded rows..." value="${this._escape(filterText)}" aria-label="Filter loaded query results">
                <button type="button" id="adminSqlClearFilterBtn" style="border:none;background:transparent;cursor:pointer;color:var(--admin-text-muted);padding:0;display:${filterText ? 'inline' : 'none'};" title="Clear filter">&times;</button>
              </div>

              <button class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._executeSqlQuery()" title="Re-run query">
                ${ICONS['refresh-cw'] || ''} Re-run
              </button>
              <button class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._copySqlResultsAsJson()" title="Copy all visible results as formatted JSON">
                ${ICONS['copy']} Copy JSON
              </button>
              <button class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._copySqlResultsAsCsv()" title="Copy all visible results as CSV">
                ${ICONS.download || ''} Copy CSV
              </button>
              <button class="admin-btn admin-btn-secondary admin-btn-sm" type="button" onclick="AdminShell._clearSqlResults()" title="Clear results view">
                ${ICONS['trash-2'] || ''} Clear
              </button>
            </div>
          </div>

          <div class="admin-sql-table-container">
            <table class="admin-sql-table">
              <thead id="adminSqlResultTableHead"></thead>
              <tbody id="adminSqlResultTableBody"></tbody>
            </table>
          </div>
        </div>
      `;

      // Build table header with safe DOM nodes
      const thead = document.getElementById('adminSqlResultTableHead');
      if (thead) {
        const theadTr = document.createElement('tr');

        const thIdx = document.createElement('th');
        thIdx.className = 'row-idx-col';
        thIdx.title = 'Row Index / Click number to copy row as JSON';
        thIdx.textContent = '#';
        theadTr.appendChild(thIdx);

        columns.forEach(col => {
          const th = document.createElement('th');
          th.textContent = col;
          th.title = col;
          theadTr.appendChild(th);
        });

        thead.appendChild(theadTr);
      }

      this._renderSqlResultsTableBody();
      this._updateSqlResultsCountHeader();

      // Search input bindings
      const searchInput = document.getElementById('adminSqlResultSearchInput');
      const clearBtn = document.getElementById('adminSqlClearFilterBtn');

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const val = e.target.value;
          if (clearBtn) clearBtn.style.display = val ? 'inline' : 'none';
          this._filterSqlResults(val);
        });
      }

      if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearBtn.style.display = 'none';
          this._filterSqlResults('');
          searchInput.focus();
        });
      }
    }

    _clearSqlResults() {
      this.sqlResultState = {
        rows: [],
        columns: [],
        totalCount: 0,
        filteredRows: [],
        filterText: '',
        executionTimeMs: 0,
        statementType: '',
        truncated: false,
        hasExecuted: false
      };

      const resultsWrap = document.getElementById('adminSqlResultsWrap');
      if (resultsWrap) {
        resultsWrap.innerHTML = `
          <div class="admin-card" style="padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);border:1px dashed var(--admin-border);border-radius:var(--radius-md);">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;opacity:0.6;">${ICONS.database || '⚡'}</div>
            <h4 style="margin:0 0 0.25rem 0;color:var(--admin-text-secondary);font-size:0.9375rem;">Query Console Ready</h4>
            <p style="margin:0;font-size:0.8125rem;">Write or select a read-only SQL query above and click <strong>Execute Query</strong> or press <kbd style="background:var(--admin-bg-subtle);padding:1px 5px;border-radius:3px;">Ctrl+Enter</kbd>.</p>
          </div>
        `;
      }

      this._updateSqlStatusBadge('idle', 'IDLE');
    }

    async _executeSqlQuery() {
      const input = document.getElementById('adminSqlQueryInput');
      const resultsWrap = document.getElementById('adminSqlResultsWrap');
      const runBtn = document.getElementById('adminSqlRunBtn');
      if (!input || !resultsWrap) return;

      const sql = input.value.trim();
      if (!sql) {
        this.toast('Please enter a SQL query to execute.', 'warning');
        return;
      }

      if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = `${ICONS['refresh-cw']} <span>Running Query...</span>`;
      }

      this._updateSqlStatusBadge('running', 'RUNNING');

      resultsWrap.innerHTML = `
        <div class="admin-card" style="padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);border-radius:var(--radius-md);">
          <div style="display:inline-block;animation:spin 1s linear infinite;font-size:1.5rem;margin-bottom:0.75rem;color:var(--admin-primary);">${ICONS['refresh-cw']}</div>
          <h4 style="margin:0 0 0.25rem 0;color:var(--admin-text-primary);font-size:0.9375rem;">Executing Query Safely...</h4>
          <p style="margin:0;font-size:0.8125rem;">Validating AST safeguards, enforcing read-only boundary &amp; masking sensitive columns.</p>
        </div>
      `;

      try {
        const response = await window.AdminApi.executeSqlQuery(sql);
        if (!response.success) {
          throw response;
        }

        const data = response.data || {};
        const rows = data.rows || [];
        const columns = data.columns || [];
        const rowCount = data.rowCount !== undefined ? data.rowCount : rows.length;
        const execTime = data.executionTimeMs !== undefined ? data.executionTimeMs : 0;
        const stmtType = data.statementType || 'QUERY';
        const isTruncated = Boolean(data.truncated);

        this.sqlResultState = {
          rows,
          columns,
          totalCount: rowCount,
          filteredRows: rows,
          filterText: '',
          executionTimeMs: execTime,
          statementType: stmtType,
          truncated: isTruncated,
          hasExecuted: true
        };

        this._recordSqlHistoryEntry({
          sql,
          statementType: stmtType,
          status: 'SUCCESS',
          executionTimeMs: execTime,
          rowCount,
          truncated: isTruncated,
          errorMessage: null
        });

        this._updateSqlStatusBadge('success', 'SUCCESS', `${rowCount} row${rowCount === 1 ? '' : 's'}, ${execTime}ms`);
        this._renderSqlResults();
      } catch (err) {
        this.sqlResultState.hasExecuted = false;
        const errObj = err.error || err;
        const errCode = errObj.code || err.code || 'SQL_ERROR';
        const errMsg = errObj.message || err.message || 'Execution failed';
        const isTimeout = errCode === 'SQL_QUERY_TIMEOUT' || err.status === 408 || err.status === 504 || errMsg.toLowerCase().includes('timeout');
        const isRejected = errCode === 'SQL_SAFETY_VIOLATION' || errCode === 'SQL_QUERY_REJECTED' || err.status === 400;

        const outcomeStatus = isTimeout ? 'TIMEOUT' : (isRejected ? 'REJECTED' : 'ERROR');

        this._recordSqlHistoryEntry({
          sql,
          statementType: 'QUERY',
          status: outcomeStatus,
          executionTimeMs: 0,
          rowCount: 0,
          truncated: false,
          errorMessage: `[${errCode}] ${errMsg}`
        });

        if (isTimeout) {
          this._updateSqlStatusBadge('timeout', 'TIMEOUT');
        } else if (isRejected) {
          this._updateSqlStatusBadge('rejected', 'REJECTED');
        } else {
          this._updateSqlStatusBadge('error', 'ERROR');
        }

        resultsWrap.innerHTML = `
          <div class="admin-card" style="border-left:4px solid ${isRejected ? 'var(--admin-warning, #f59e0b)' : 'var(--admin-danger, #ef4444)'};padding:1.5rem;border-radius:var(--radius-md);">
            <div style="display:flex;align-items:flex-start;gap:1rem;">
              <div style="color:${isRejected ? '#d97706' : '#dc2626'};font-size:1.25rem;line-height:1;margin-top:2px;">
                ${ICONS['alert-triangle'] || '⚠️'}
              </div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
                  <h4 style="margin:0;color:${isRejected ? '#b45309' : '#b91c1c'};font-size:0.9375rem;font-weight:700;">
                    ${isTimeout ? 'Statement Timeout Exceeded (5,000ms)' : (isRejected ? 'SQL Safety Policy Violation' : 'Query Execution Error')}
                  </h4>
                  <span class="admin-badge ${isRejected ? 'admin-badge-warning' : 'admin-badge-danger'}" style="font-family:var(--font-mono);font-size:0.75rem;">
                    ${this._escape(errCode)}
                  </span>
                </div>
                <p style="margin:0 0 0.75rem 0;font-size:0.8125rem;color:var(--admin-text-secondary);">
                  ${isRejected ? 'The requested statement was rejected before database execution by the read-only security safety guard.' : (isTimeout ? 'The query exceeded the maximum allowable execution window of 5,000ms and was terminated by MySQL optimizer timeout.' : 'The query encountered an execution error inside the database.')}
                </p>
                <div style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--admin-text-primary);background:var(--admin-bg-base);padding:0.75rem 1rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);white-space:pre-wrap;word-break:break-all;">${this._escape(errMsg)}</div>
              </div>
            </div>
          </div>
        `;
      } finally {
        if (runBtn) {
          runBtn.disabled = false;
          if (this.sqlMode === 'CONTROLLED_WRITE') {
            runBtn.innerHTML = `${ICONS['alert-triangle'] || ICONS['play']} <span>Execute Write</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>`;
          } else {
            runBtn.innerHTML = `${ICONS['play']} <span>Execute Query</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>`;
          }
        }
      }
    }

    _setSqlMode(mode) {
      this.sqlMode = mode;
      const container = document.getElementById('adminViewContainer');
      if (container) {
        this._renderSqlRunnerView(container);
      }
    }

    _promptControlledWriteMode() {
      if (this.sqlMode === 'CONTROLLED_WRITE') return;

      const content = document.createElement('div');
      content.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;font-size:0.875rem;line-height:1.5;color:var(--admin-text-primary);';

      const warningCard = document.createElement('div');
      warningCard.style.cssText = 'background:rgba(245,158,11,0.1);border-left:4px solid #f59e0b;padding:0.875rem 1rem;border-radius:var(--radius-xs);';
      warningCard.innerHTML = `
        <strong style="color:#b45309;display:block;margin-bottom:0.25rem;">Warning: Direct Database Write Mode</strong>
        <p style="margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);">
          Controlled Write Mode enables administrative data updates and insertions directly against the application database.
        </p>
      `;
      content.appendChild(warningCard);

      const listDiv = document.createElement('div');
      listDiv.innerHTML = `
        <div style="font-weight:600;font-size:0.8125rem;margin-bottom:0.5rem;color:var(--admin-text-primary);">Safety &amp; Compliance Enforcements:</div>
        <ul style="padding-left:1.25rem;margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);display:flex;flex-direction:column;gap:0.35rem;">
          <li>Permitted operations: <code>INSERT</code> and <code>UPDATE</code> only.</li>
          <li>All operations run in an atomic transaction with a strict <strong>50 row maximum modification limit</strong>.</li>
          <li><code>UPDATE</code> queries MUST include a specific non-trivial <code>WHERE</code> clause.</li>
          <li>Protected system tables (authentication, sessions, audit records) are completely guarded.</li>
          <li>Every execution is immutably audited with actor credentials and IP address.</li>
        </ul>
      `;
      content.appendChild(listDiv);

      const notice = document.createElement('p');
      notice.style.cssText = 'margin:0;font-size:0.75rem;color:var(--admin-text-muted);font-style:italic;';
      notice.textContent = 'Controlled Write Mode is session-only and will automatically reset to Read-Only Mode on page reload or logout.';
      content.appendChild(notice);

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => this._closeDrawer();
      actionsDiv.appendChild(cancelBtn);

      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'admin-btn admin-btn-warning admin-btn-sm';
      enableBtn.textContent = 'Enable Controlled Write Mode';
      enableBtn.onclick = () => {
        this._closeDrawer();
        this._setSqlMode('CONTROLLED_WRITE');
        this.toast('Controlled Write Mode enabled for this session.', 'warning');
      };
      actionsDiv.appendChild(enableBtn);

      content.appendChild(actionsDiv);

      this._showDrawer('Enable Controlled Write Mode', content);
    }

    _openExecuteWriteModal() {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input) return;
      const sql = input.value.trim();
      if (!sql) {
        this.toast('Please enter a SQL write statement to execute.', 'warning');
        return;
      }

      const content = document.createElement('div');
      content.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;font-size:0.875rem;line-height:1.5;';

      const desc = document.createElement('p');
      desc.style.cssText = 'margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);';
      desc.textContent = 'Please review the SQL statement to execute within an isolated transactional boundary (max 50 rows affected):';
      content.appendChild(desc);

      const sqlBox = document.createElement('div');
      sqlBox.style.cssText = 'background:var(--admin-bg-base);border:1px solid var(--admin-border);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-family:var(--font-mono);font-size:0.8125rem;color:var(--admin-text-primary);max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;';
      sqlBox.textContent = sql;
      content.appendChild(sqlBox);

      const warnBox = document.createElement('div');
      warnBox.style.cssText = 'background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:var(--radius-xs);padding:0.6rem 0.85rem;font-size:0.8125rem;color:#b45309;display:flex;align-items:center;gap:0.5rem;';
      warnBox.innerHTML = `<span>${ICONS['alert-triangle'] || '⚠️'}</span> <span>Are you sure you want to commit these database modifications?</span>`;
      content.appendChild(warnBox);

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => this._closeDrawer();
      actionsDiv.appendChild(cancelBtn);

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'admin-btn admin-btn-warning admin-btn-sm';
      confirmBtn.textContent = 'Confirm & Execute Write';
      confirmBtn.onclick = () => {
        this._closeDrawer();
        this._executeSqlWriteQuery(sql);
      };
      actionsDiv.appendChild(confirmBtn);

      content.appendChild(actionsDiv);

      this._showDrawer('Confirm Controlled SQL Write Execution', content);
    }

    async _executeSqlWriteQuery(sql) {
      const resultsWrap = document.getElementById('adminSqlResultsWrap');
      const runBtn = document.getElementById('adminSqlRunBtn');
      if (!resultsWrap) return;

      if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = `${ICONS['refresh-cw']} <span>Writing...</span>`;
      }

      this._updateSqlStatusBadge('running', 'EXECUTING WRITE');

      resultsWrap.innerHTML = `
        <div class="admin-card" style="padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);border-radius:var(--radius-md);">
          <div style="display:inline-block;animation:spin 1s linear infinite;font-size:1.5rem;margin-bottom:0.75rem;color:#d97706;">${ICONS['refresh-cw']}</div>
          <h4 style="margin:0 0 0.25rem 0;color:var(--admin-text-primary);font-size:0.9375rem;">Executing Controlled Write...</h4>
          <p style="margin:0;font-size:0.8125rem;">Enforcing transactional boundaries, verifying affected row limits &amp; logging immutable audit record.</p>
        </div>
      `;

      try {
        const response = await window.AdminApi.executeControlledWriteQuery(sql, true);
        if (!response.success) {
          throw response;
        }

        const data = response.data || {};
        const statementType = data.statementType || 'WRITE';
        const targetTable = data.targetTable || 'UNKNOWN';
        const affectedRows = data.affectedRows !== undefined ? data.affectedRows : 0;
        const execTime = data.executionTimeMs !== undefined ? data.executionTimeMs : 0;

        this.sqlResultState = {
          rows: [],
          columns: [],
          totalCount: affectedRows,
          filteredRows: [],
          filterText: '',
          executionTimeMs: execTime,
          statementType,
          truncated: false,
          hasExecuted: true
        };

        this._recordSqlHistoryEntry({
          sql,
          statementType,
          status: 'COMMITTED',
          executionTimeMs: execTime,
          rowCount: affectedRows,
          truncated: false,
          errorMessage: null
        });

        this._updateSqlStatusBadge('success', 'COMMITTED', `${affectedRows} row${affectedRows === 1 ? '' : 's'} affected, ${execTime}ms`);

        resultsWrap.innerHTML = `
          <div class="admin-card" style="border-left:4px solid #10b981;padding:1.5rem;border-radius:var(--radius-md);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
              <div style="display:flex;align-items:center;gap:0.75rem;">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(16,185,129,0.12);color:#059669;display:flex;align-items:center;justify-content:center;font-size:1.125rem;">
                  ${ICONS.check || '✓'}
                </div>
                <div>
                  <h4 style="margin:0;color:var(--admin-text-primary);font-size:1rem;font-weight:700;">Transaction Committed Successfully</h4>
                  <p style="margin:0.125rem 0 0 0;font-size:0.8125rem;color:var(--admin-text-muted);">
                    Statement type: <strong>${this._escape(statementType)}</strong> &bull; Target table: <strong>${this._escape(targetTable)}</strong>
                  </p>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span class="admin-badge admin-badge-success" style="font-family:var(--font-mono);font-size:0.75rem;">COMMITTED</span>
                <span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);font-size:0.75rem;">${execTime}ms</span>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:1rem;background:var(--admin-bg-base);padding:1rem;border-radius:var(--radius-sm);border:1px solid var(--admin-border);">
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Rows Affected</div>
                <div style="font-size:1.25rem;font-weight:700;color:#059669;margin-top:0.25rem;">${affectedRows}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Target Entity</div>
                <div style="font-size:1.125rem;font-weight:600;color:var(--admin-text-primary);margin-top:0.25rem;font-family:var(--font-mono);">${this._escape(targetTable)}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Safety Ceiling</div>
                <div style="font-size:0.875rem;font-weight:500;color:var(--admin-text-secondary);margin-top:0.25rem;">50 rows max / auto-rollback</div>
              </div>
            </div>
          </div>
        `;
      } catch (err) {
        this.sqlResultState.hasExecuted = false;
        const errObj = err.error || err;
        const errCode = errObj.code || err.code || 'SQL_WRITE_ERROR';
        const errMsg = errObj.message || err.message || 'Write execution failed';
        const isRolledBack = errCode === 'SQL_WRITE_AFFECTED_ROWS_EXCEEDED' || errMsg.toLowerCase().includes('rolled back');
        const isTimeout = errCode === 'SQL_QUERY_TIMEOUT' || err.status === 408 || errMsg.toLowerCase().includes('timeout');

        const outcomeStatus = isRolledBack ? 'ROLLED_BACK' : (isTimeout ? 'TIMEOUT' : 'REJECTED');

        this._recordSqlHistoryEntry({
          sql,
          statementType: 'WRITE',
          status: outcomeStatus,
          executionTimeMs: 0,
          rowCount: 0,
          truncated: false,
          errorMessage: `[${errCode}] ${errMsg}`
        });

        if (isRolledBack) {
          this._updateSqlStatusBadge('rejected', 'ROLLED BACK');
        } else if (isTimeout) {
          this._updateSqlStatusBadge('timeout', 'TIMEOUT');
        } else {
          this._updateSqlStatusBadge('rejected', 'REJECTED');
        }

        resultsWrap.innerHTML = `
          <div class="admin-card" style="border-left:4px solid ${isRolledBack ? '#f59e0b' : '#ef4444'};padding:1.5rem;border-radius:var(--radius-md);">
            <div style="display:flex;align-items:flex-start;gap:1rem;">
              <div style="color:${isRolledBack ? '#d97706' : '#dc2626'};font-size:1.25rem;line-height:1;margin-top:2px;">
                ${ICONS['alert-triangle'] || '⚠️'}
              </div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
                  <h4 style="margin:0;color:${isRolledBack ? '#b45309' : '#b91c1c'};font-size:0.9375rem;font-weight:700;">
                    ${isRolledBack ? 'Transaction Automatically Rolled Back' : 'Write Operation Rejected'}
                  </h4>
                  <span class="admin-badge ${isRolledBack ? 'admin-badge-warning' : 'admin-badge-danger'}" style="font-family:var(--font-mono);font-size:0.75rem;">
                    ${this._escape(errCode)}
                  </span>
                </div>
                <p style="margin:0 0 0.75rem 0;font-size:0.8125rem;color:var(--admin-text-secondary);">
                  ${isRolledBack ? 'The write query modified more rows than the allowable safety ceiling (max 50 rows). The transaction was completely rolled back and no data was altered.' : 'The requested write statement was rejected by Controlled Write Mode safety policy.'}
                </p>
                <div style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--admin-text-primary);background:var(--admin-bg-base);padding:0.75rem 1rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);white-space:pre-wrap;word-break:break-all;">${this._escape(errMsg)}</div>
              </div>
            </div>
          </div>
        `;
      } finally {
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.innerHTML = `${ICONS['alert-triangle'] || ICONS['play']} <span>Execute Write</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>`;
        }
      }
    }

    _promptDestructiveMode() {
      if (this.sqlMode === 'DESTRUCTIVE') return;

      const content = document.createElement('div');
      content.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;font-size:0.875rem;line-height:1.5;color:var(--admin-text-primary);';

      const warningCard = document.createElement('div');
      warningCard.style.cssText = 'background:rgba(239,68,68,0.1);border-left:4px solid #ef4444;padding:0.875rem 1rem;border-radius:var(--radius-xs);';
      warningCard.innerHTML = `
        <strong style="color:#b91c1c;display:block;margin-bottom:0.25rem;">Critical Warning: Destructive SQL Delete Mode</strong>
        <p style="margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);">
          Destructive Mode authorizes administrative row deletions directly from the application database. Data deleted in this mode cannot be undone.
        </p>
      `;
      content.appendChild(warningCard);

      const listDiv = document.createElement('div');
      listDiv.innerHTML = `
        <div style="font-weight:600;font-size:0.8125rem;margin-bottom:0.5rem;color:var(--admin-text-primary);">Destructive Safety &amp; Guardrail Enforcements:</div>
        <ul style="padding-left:1.25rem;margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);display:flex;flex-direction:column;gap:0.35rem;">
          <li>Permitted operations: Single-statement <code>DELETE FROM table WHERE ...</code> only.</li>
          <li>All operations run in an atomic transaction with a strict <strong>50 row maximum deletion limit</strong>.</li>
          <li><code>DELETE</code> queries MUST include a specific non-trivial <code>WHERE</code> clause.</li>
          <li>Schema-destructive operations (<code>TRUNCATE</code>, <code>DROP</code>, <code>ALTER</code>) are strictly prohibited.</li>
          <li>Protected system tables (authentication, audit records, credentials) are blocked.</li>
          <li>Every execution is immutably audited with actor credentials, IP address, and cryptographic tamper-evident hash chaining.</li>
        </ul>
      `;
      content.appendChild(listDiv);

      const notice = document.createElement('p');
      notice.style.cssText = 'margin:0;font-size:0.75rem;color:var(--admin-text-muted);font-style:italic;';
      notice.textContent = 'Destructive Mode is session-only and will automatically reset to Read-Only Mode on page reload or logout.';
      content.appendChild(notice);

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => this._closeDrawer();
      actionsDiv.appendChild(cancelBtn);

      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'admin-btn admin-btn-danger admin-btn-sm';
      enableBtn.textContent = 'Enable Destructive Mode';
      enableBtn.onclick = () => {
        this._closeDrawer();
        this._setSqlMode('DESTRUCTIVE');
        this.toast('Destructive SQL Mode enabled for this session.', 'danger');
      };
      actionsDiv.appendChild(enableBtn);

      content.appendChild(actionsDiv);

      this._showDrawer('Enable Destructive SQL Mode', content);
    }

    _openExecuteDestructiveModal() {
      const input = document.getElementById('adminSqlQueryInput');
      if (!input) return;
      const sql = input.value.trim();
      if (!sql) {
        this.toast('Please enter a SQL DELETE statement to execute.', 'warning');
        return;
      }

      const content = document.createElement('div');
      content.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;font-size:0.875rem;line-height:1.5;';

      const desc = document.createElement('p');
      desc.style.cssText = 'margin:0;font-size:0.8125rem;color:var(--admin-text-secondary);';
      desc.textContent = 'Please review the destructive DELETE statement to execute within an isolated transactional boundary (max 50 deletions):';
      content.appendChild(desc);

      const sqlBox = document.createElement('div');
      sqlBox.style.cssText = 'background:var(--admin-bg-base);border:1px solid var(--admin-border);padding:0.75rem 1rem;border-radius:var(--radius-xs);font-family:var(--font-mono);font-size:0.8125rem;color:var(--admin-text-primary);max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;';
      sqlBox.textContent = sql;
      content.appendChild(sqlBox);

      const warnBox = document.createElement('div');
      warnBox.style.cssText = 'background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-xs);padding:0.6rem 0.85rem;font-size:0.8125rem;color:#b91c1c;display:flex;align-items:center;gap:0.5rem;';
      warnBox.innerHTML = `<span>${ICONS['alert-triangle'] || '⚠️'}</span> <span><strong>Irreversible action:</strong> Deleted database rows cannot be restored. Proceed?</span>`;
      content.appendChild(warnBox);

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => this._closeDrawer();
      actionsDiv.appendChild(cancelBtn);

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'admin-btn admin-btn-danger admin-btn-sm';
      confirmBtn.textContent = 'Confirm & Execute Delete';
      confirmBtn.onclick = () => {
        this._closeDrawer();
        this._executeSqlDestructiveQuery(sql);
      };
      actionsDiv.appendChild(confirmBtn);

      content.appendChild(actionsDiv);

      this._showDrawer('Confirm Destructive SQL Execution', content);
    }

    async _executeSqlDestructiveQuery(sql) {
      const resultsWrap = document.getElementById('adminSqlResultsWrap');
      const runBtn = document.getElementById('adminSqlRunBtn');
      if (!resultsWrap) return;

      if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = `${ICONS['refresh-cw']} <span>Deleting...</span>`;
      }

      this._updateSqlStatusBadge('running', 'EXECUTING DELETION');

      resultsWrap.innerHTML = `
        <div class="admin-card" style="padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);border-radius:var(--radius-md);">
          <div style="display:inline-block;animation:spin 1s linear infinite;font-size:1.5rem;margin-bottom:0.75rem;color:#dc2626;">${ICONS['refresh-cw']}</div>
          <h4 style="margin:0 0 0.25rem 0;color:var(--admin-text-primary);font-size:0.9375rem;">Executing Destructive Delete...</h4>
          <p style="margin:0;font-size:0.8125rem;">Enforcing transactional boundaries, verifying affected row limits &amp; logging tamper-evident audit record.</p>
        </div>
      `;

      try {
        const response = await window.AdminApi.executeDestructiveQuery(sql, true);
        if (!response.success) {
          throw response;
        }

        const data = response.data || {};
        const statementType = data.statementType || 'DELETE';
        const targetTable = data.targetTable || 'UNKNOWN';
        const affectedRows = data.affectedRows !== undefined ? data.affectedRows : 0;
        const execTime = data.executionTimeMs !== undefined ? data.executionTimeMs : 0;

        this.sqlResultState = {
          rows: [],
          columns: [],
          totalCount: affectedRows,
          filteredRows: [],
          filterText: '',
          executionTimeMs: execTime,
          statementType,
          truncated: false,
          hasExecuted: true
        };

        this._recordSqlHistoryEntry({
          sql,
          statementType,
          status: 'COMMITTED',
          executionTimeMs: execTime,
          rowCount: affectedRows,
          truncated: false,
          errorMessage: null
        });

        this._updateSqlStatusBadge('success', 'COMMITTED', `${affectedRows} row${affectedRows === 1 ? '' : 's'} deleted, ${execTime}ms`);

        resultsWrap.innerHTML = `
          <div class="admin-card" style="border-left:4px solid #10b981;padding:1.5rem;border-radius:var(--radius-md);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
              <div style="display:flex;align-items:center;gap:0.75rem;">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(16,185,129,0.12);color:#059669;display:flex;align-items:center;justify-content:center;font-size:1.125rem;">
                  ${ICONS.check || '✓'}
                </div>
                <div>
                  <h4 style="margin:0;color:var(--admin-text-primary);font-size:1rem;font-weight:700;">Destructive Transaction Committed Successfully</h4>
                  <p style="margin:0.125rem 0 0 0;font-size:0.8125rem;color:var(--admin-text-muted);">
                    Statement type: <strong>${this._escape(statementType)}</strong> &bull; Target table: <strong>${this._escape(targetTable)}</strong>
                  </p>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span class="admin-badge admin-badge-success" style="font-family:var(--font-mono);font-size:0.75rem;">COMMITTED</span>
                <span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);font-size:0.75rem;">${execTime}ms</span>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:1rem;background:var(--admin-bg-base);padding:1rem;border-radius:var(--radius-sm);border:1px solid var(--admin-border);">
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Rows Deleted</div>
                <div style="font-size:1.25rem;font-weight:700;color:#dc2626;margin-top:0.25rem;">${affectedRows}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Target Entity</div>
                <div style="font-size:1.125rem;font-weight:600;color:var(--admin-text-primary);margin-top:0.25rem;font-family:var(--font-mono);">${this._escape(targetTable)}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Safety Ceiling</div>
                <div style="font-size:0.875rem;font-weight:500;color:var(--admin-text-secondary);margin-top:0.25rem;">50 deletions max / auto-rollback</div>
              </div>
            </div>
          </div>
        `;
      } catch (err) {
        this.sqlResultState.hasExecuted = false;
        const errObj = err.error || err;
        const errCode = errObj.code || err.code || 'SQL_DESTRUCTIVE_ERROR';
        const errMsg = errObj.message || err.message || 'Destructive execution failed';
        const isRolledBack = errCode === 'SQL_DESTRUCTIVE_AFFECTED_ROWS_EXCEEDED' || errMsg.toLowerCase().includes('rolled back');
        const isTimeout = errCode === 'SQL_QUERY_TIMEOUT' || err.status === 408 || errMsg.toLowerCase().includes('timeout');

        const outcomeStatus = isRolledBack ? 'ROLLED_BACK' : (isTimeout ? 'TIMEOUT' : 'REJECTED');

        this._recordSqlHistoryEntry({
          sql,
          statementType: 'DELETE',
          status: outcomeStatus,
          executionTimeMs: 0,
          rowCount: 0,
          truncated: false,
          errorMessage: `[${errCode}] ${errMsg}`
        });

        if (isRolledBack) {
          this._updateSqlStatusBadge('rejected', 'ROLLED BACK');
        } else if (isTimeout) {
          this._updateSqlStatusBadge('timeout', 'TIMEOUT');
        } else {
          this._updateSqlStatusBadge('rejected', 'REJECTED');
        }

        resultsWrap.innerHTML = `
          <div class="admin-card" style="border-left:4px solid ${isRolledBack ? '#f59e0b' : '#ef4444'};padding:1.5rem;border-radius:var(--radius-md);">
            <div style="display:flex;align-items:flex-start;gap:1rem;">
              <div style="color:${isRolledBack ? '#d97706' : '#dc2626'};font-size:1.25rem;line-height:1;margin-top:2px;">
                ${ICONS['alert-triangle'] || '⚠️'}
              </div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
                  <h4 style="margin:0;color:${isRolledBack ? '#b45309' : '#b91c1c'};font-size:0.9375rem;font-weight:700;">
                    ${isRolledBack ? 'Transaction Automatically Rolled Back' : 'Destructive Operation Rejected'}
                  </h4>
                  <span class="admin-badge ${isRolledBack ? 'admin-badge-warning' : 'admin-badge-danger'}" style="font-family:var(--font-mono);font-size:0.75rem;">
                    ${this._escape(errCode)}
                  </span>
                </div>
                <p style="margin:0 0 0.75rem 0;font-size:0.8125rem;color:var(--admin-text-secondary);">
                  ${isRolledBack ? 'The delete query matched more rows than the allowable safety ceiling (max 50 rows). The transaction was completely rolled back and no rows were deleted.' : 'The requested delete statement was rejected by Destructive Query Protection safety policy.'}
                </p>
                <div style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--admin-text-primary);background:var(--admin-bg-base);padding:0.75rem 1rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);white-space:pre-wrap;word-break:break-all;">${this._escape(errMsg)}</div>
              </div>
            </div>
          </div>
        `;
      } finally {
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.innerHTML = `${ICONS['trash-2'] || ICONS['alert-triangle']} <span>Execute Delete</span> <kbd style="background:rgba(255,255,255,0.25);color:#fff;border-radius:3px;padding:1px 5px;font-size:0.75rem;margin-left:4px;font-family:var(--font-mono);">Ctrl+↵</kbd>`;
        }
      }
    }

    _getCurrentAdminId() {
      if (!window.AdminAuth || !window.AdminAuth.currentUser) return null;
      const user = window.AdminAuth.currentUser;
      const id = user.id || user.userId || user.email;
      if (!id || typeof id !== 'string') return null;
      const clean = id.trim();
      if (!clean || ['undefined', 'null', 'default', 'guest', 'admin'].includes(clean)) return null;
      return clean;
    }

    _getSqlHistoryStorageKey() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) return null;
      if (window.SqlHistory && window.SqlHistory.getSqlHistoryStorageKey) {
        return window.SqlHistory.getSqlHistoryStorageKey(adminId);
      }
      return `zdex_admin_sql_history_${adminId}`;
    }

    _loadSqlHistory() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) {
        this.sqlHistoryState.entries = [];
        return;
      }
      if (window.SqlHistory && window.SqlHistory.loadSqlHistory) {
        this.sqlHistoryState.entries = window.SqlHistory.loadSqlHistory(localStorage, adminId);
      } else {
        try {
          const key = this._getSqlHistoryStorageKey();
          if (!key) { this.sqlHistoryState.entries = []; return; }
          const raw = localStorage.getItem(key);
          this.sqlHistoryState.entries = raw ? JSON.parse(raw).slice(0, 50) : [];
        } catch (_) {
          this.sqlHistoryState.entries = [];
        }
      }
    }

    _saveSqlHistory() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) return;
      if (window.SqlHistory && window.SqlHistory.saveSqlHistory) {
        window.SqlHistory.saveSqlHistory(localStorage, adminId, this.sqlHistoryState.entries);
      } else {
        try {
          const key = this._getSqlHistoryStorageKey();
          if (key) localStorage.setItem(key, JSON.stringify(this.sqlHistoryState.entries.slice(0, 50)));
        } catch (_) {}
      }
    }

    _recordSqlHistoryEntry({ sql, statementType, status, executionTimeMs, rowCount, truncated, errorMessage }) {
      if (!this._getCurrentAdminId()) return;

      if (window.SqlHistory && window.SqlHistory.recordSqlHistoryEntry && window.SqlHistory.buildSqlHistoryEntry) {
        const entry = window.SqlHistory.buildSqlHistoryEntry({
          sql,
          statementType,
          status,
          executionTimeMs,
          rowCount,
          truncated,
          errorMessage
        });
        this.sqlHistoryState.entries = window.SqlHistory.recordSqlHistoryEntry(this.sqlHistoryState.entries, entry);
      } else {
        const entry = {
          id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          executedAt: new Date().toISOString(),
          sql: sql ? sql.trim() : '',
          statementType: statementType || 'QUERY',
          status: status || 'SUCCESS',
          executionTimeMs: typeof executionTimeMs === 'number' ? executionTimeMs : 0,
          rowCount: typeof rowCount === 'number' ? rowCount : 0,
          truncated: Boolean(truncated),
          errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null
        };
        this.sqlHistoryState.entries.unshift(entry);
        if (this.sqlHistoryState.entries.length > 50) {
          this.sqlHistoryState.entries = this.sqlHistoryState.entries.slice(0, 50);
        }
      }

      this._saveSqlHistory();
      this._renderSqlHistoryList();
    }

    _renderSqlHistory() {
      const wrap = document.getElementById('adminSqlHistoryWrap');
      if (!wrap) return;

      if (!this._getCurrentAdminId()) {
        wrap.innerHTML = '';
        return;
      }

      wrap.innerHTML = `
        <div class="admin-sql-history-card">
          <div class="admin-sql-history-header">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <h3 style="margin:0;font-size:0.9375rem;font-weight:700;color:var(--admin-text-primary);display:flex;align-items:center;gap:0.5rem;">
                <span>Query History</span>
                <span id="adminSqlHistoryCountBadge" class="admin-badge admin-badge-neutral" style="font-family:var(--font-mono);font-size:0.75rem;">0 / 50</span>
              </h3>
              <span style="font-size:0.75rem;color:var(--admin-text-muted);" title="Per-administrator browser-local persistent query history. Browser storage is not a confidentiality boundary; stored SQL may contain administrator-supplied sensitive literals.">(Per-administrator browser-local persistent query history &bull; Max 50 queries)</span>
            </div>
            <div class="admin-sql-history-toolbar">
              <div class="admin-sql-search-box" style="width:200px;">
                ${ICONS.search || ''}
                <input type="text" id="adminSqlHistorySearchInput" class="admin-sql-search-input" placeholder="Search history..." value="${this._escape(this.sqlHistoryState.filterText)}" aria-label="Search query history">
              </div>
              <select id="adminSqlHistoryStatusFilter" class="admin-select" style="padding:0.25rem 0.5rem;font-size:0.75rem;height:30px;">
                <option value="ALL" ${this.sqlHistoryState.statusFilter === 'ALL' ? 'selected' : ''}>All Statuses</option>
                <option value="SUCCESS" ${this.sqlHistoryState.statusFilter === 'SUCCESS' ? 'selected' : ''}>Success</option>
                <option value="ERROR" ${this.sqlHistoryState.statusFilter === 'ERROR' ? 'selected' : ''}>Error</option>
                <option value="REJECTED" ${this.sqlHistoryState.statusFilter === 'REJECTED' ? 'selected' : ''}>Rejected</option>
                <option value="TIMEOUT" ${this.sqlHistoryState.statusFilter === 'TIMEOUT' ? 'selected' : ''}>Timeout</option>
              </select>
              <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.confirmClearSqlHistory()" title="Clear all local query history">
                ${ICONS['trash-2'] || ''} Clear History
              </button>
            </div>
          </div>
          <div id="adminSqlHistoryList" class="admin-sql-history-list"></div>
        </div>
      `;

      const searchInput = document.getElementById('adminSqlHistorySearchInput');
      const statusSelect = document.getElementById('adminSqlHistoryStatusFilter');

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this._filterSqlHistory(e.target.value, undefined);
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this._filterSqlHistory(undefined, e.target.value);
        });
      }

      this._renderSqlHistoryList();
    }

    _filterSqlHistory(query, status) {
      if (query !== undefined) this.sqlHistoryState.filterText = (query || '').trim().toLowerCase();
      if (status !== undefined) this.sqlHistoryState.statusFilter = status;
      this._renderSqlHistoryList();
    }

    _renderSqlHistoryList() {
      const listEl = document.getElementById('adminSqlHistoryList');
      const countBadge = document.getElementById('adminSqlHistoryCountBadge');
      if (!listEl) return;

      if (!this._getCurrentAdminId()) {
        this.sqlHistoryState.entries = [];
        this.sqlHistoryState.expandedIds.clear();
        listEl.textContent = '';
        if (countBadge) countBadge.textContent = '0 / 50';
        return;
      }

      if (countBadge) {
        countBadge.textContent = `${this.sqlHistoryState.entries.length} / 50`;
      }

      listEl.textContent = '';

      if (this.sqlHistoryState.entries.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.875rem;';
        emptyDiv.textContent = 'No query history recorded yet. Executed queries will appear here automatically.';
        listEl.appendChild(emptyDiv);
        return;
      }

      const filterText = (this.sqlHistoryState.filterText || '').toLowerCase();
      const statusFilter = this.sqlHistoryState.statusFilter || 'ALL';

      const filtered = (window.SqlHistory && window.SqlHistory.filterSqlHistory)
        ? window.SqlHistory.filterSqlHistory(this.sqlHistoryState.entries, filterText, statusFilter)
        : this.sqlHistoryState.entries.filter(entry => {
            if (statusFilter !== 'ALL' && entry.status !== statusFilter) return false;
            if (filterText) {
              const matchSql = entry.sql && entry.sql.toLowerCase().includes(filterText);
              const matchErr = entry.errorMessage && entry.errorMessage.toLowerCase().includes(filterText);
              const matchStmt = entry.statementType && entry.statementType.toLowerCase().includes(filterText);
              if (!matchSql && !matchErr && !matchStmt) return false;
            }
            return true;
          });

      if (filtered.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.875rem;';
        emptyDiv.textContent = 'No history queries match your filter criteria.';
        listEl.appendChild(emptyDiv);
        return;
      }

      filtered.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'admin-sql-history-item';

        // Top Row: Meta and Actions
        const topRow = document.createElement('div');
        topRow.className = 'admin-sql-history-item-top';

        // Meta (Left)
        const metaDiv = document.createElement('div');
        metaDiv.className = 'admin-sql-history-meta';

        // Status Badge
        const statusBadge = document.createElement('span');
        let statusBadgeClass = 'admin-badge-neutral';
        if (entry.status === 'SUCCESS') statusBadgeClass = 'admin-badge-success';
        else if (entry.status === 'REJECTED') statusBadgeClass = 'admin-badge-warning';
        else if (entry.status === 'ERROR' || entry.status === 'TIMEOUT') statusBadgeClass = 'admin-badge-danger';
        statusBadge.className = `admin-badge ${statusBadgeClass}`;
        statusBadge.textContent = entry.status;
        metaDiv.appendChild(statusBadge);

        // Statement Type Badge
        const stmtBadge = document.createElement('span');
        stmtBadge.className = 'admin-badge admin-badge-info';
        stmtBadge.textContent = entry.statementType || 'QUERY';
        metaDiv.appendChild(stmtBadge);

        // Stats summary
        const statsSpan = document.createElement('span');
        statsSpan.style.color = 'var(--admin-text-secondary)';
        if (entry.status === 'SUCCESS') {
          const rowText = `${entry.rowCount}${entry.truncated ? '+' : ''} row${entry.rowCount === 1 ? '' : 's'}`;
          statsSpan.textContent = `• ${rowText} • ${entry.executionTimeMs}ms`;
        } else {
          statsSpan.textContent = `• Failed`;
        }
        metaDiv.appendChild(statsSpan);

        // Executed Timestamp
        const timeSpan = document.createElement('span');
        timeSpan.style.color = 'var(--admin-text-muted)';
        const dateObj = new Date(entry.executedAt);
        timeSpan.textContent = `• ${dateObj.toLocaleTimeString()}`;
        timeSpan.title = dateObj.toLocaleString();
        metaDiv.appendChild(timeSpan);

        topRow.appendChild(metaDiv);

        // Actions (Right)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'admin-sql-history-actions';

        // Restore Query Button
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        restoreBtn.title = 'Restore query to editor (does not execute)';
        restoreBtn.textContent = 'Restore Query';
        restoreBtn.addEventListener('click', () => this._restoreHistoryQuery(entry.id));
        actionsDiv.appendChild(restoreBtn);

        // Copy SQL Button
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        copyBtn.title = 'Copy SQL to clipboard';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => this._copyHistorySql(entry.id));
        actionsDiv.appendChild(copyBtn);

        // Details Toggle Button
        const isExpanded = this.sqlHistoryState.expandedIds.has(entry.id);
        const detailsBtn = document.createElement('button');
        detailsBtn.type = 'button';
        detailsBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        detailsBtn.title = isExpanded ? 'Collapse details' : 'Expand full query and error details';
        detailsBtn.textContent = isExpanded ? 'Details ▲' : 'Details ▼';
        detailsBtn.addEventListener('click', () => this._toggleHistoryDetails(entry.id));
        actionsDiv.appendChild(detailsBtn);

        topRow.appendChild(actionsDiv);
        item.appendChild(topRow);

        // One-line SQL Preview (clickable to restore)
        const previewDiv = document.createElement('div');
        previewDiv.className = 'admin-sql-history-sql-preview';
        previewDiv.title = 'Click to restore query into editor';
        const singleLineSql = entry.sql.replace(/\s+/g, ' ');
        previewDiv.textContent = singleLineSql.length > 140 ? singleLineSql.substring(0, 140) + '...' : singleLineSql;
        previewDiv.addEventListener('click', () => this._restoreHistoryQuery(entry.id));
        item.appendChild(previewDiv);

        // Expanded View (Full SQL + Sanitized Error Message)
        if (isExpanded) {
          const fullSqlPre = document.createElement('pre');
          fullSqlPre.className = 'admin-sql-history-expanded-sql';
          fullSqlPre.textContent = entry.sql;
          item.appendChild(fullSqlPre);

          if (entry.errorMessage) {
            const errDiv = document.createElement('div');
            errDiv.className = 'admin-sql-history-error';
            errDiv.textContent = entry.errorMessage;
            item.appendChild(errDiv);
          }
        }

        listEl.appendChild(item);
      });
    }

    _restoreHistoryQuery(id) {
      if (!this._getCurrentAdminId()) {
        this.sqlHistoryState.entries = [];
        this.sqlHistoryState.expandedIds.clear();
        this.toast('Authentication required to access query history.', 'warning');
        return;
      }

      const entry = this.sqlHistoryState.entries.find(e => e.id === id);
      if (!entry || !entry.sql) {
        this.toast('Query not found in history.', 'warning');
        return;
      }

      const input = document.getElementById('adminSqlQueryInput');
      if (input) {
        input.value = entry.sql;
        this._updateSqlEditorGutter();
        this._updateSqlCursorPos();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
        this.toast('Query restored to editor (not executed).', 'info', 2500);
      }
    }

    _copyHistorySql(id) {
      if (!this._getCurrentAdminId()) {
        this.sqlHistoryState.entries = [];
        this.sqlHistoryState.expandedIds.clear();
        return;
      }

      const entry = this.sqlHistoryState.entries.find(e => e.id === id);
      if (!entry || !entry.sql) return;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(entry.sql).then(() => {
          this.toast('SQL statement copied to clipboard.', 'success', 2000);
        }).catch(() => {
          this.toast('Failed to copy SQL to clipboard.', 'danger');
        });
      } else {
        this.toast('Clipboard API unavailable in this browser.', 'warning');
      }
    }

    _toggleHistoryDetails(id) {
      if (this.sqlHistoryState.expandedIds.has(id)) {
        this.sqlHistoryState.expandedIds.delete(id);
      } else {
        this.sqlHistoryState.expandedIds.add(id);
      }
      this._renderSqlHistoryList();
    }

    // =========================================================================
    // Phase 15.5: Professional Saved Queries Engine Integration
    // =========================================================================
    _getSqlSavedQueriesStorageKey() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) return null;
      if (window.SqlSavedQueries && window.SqlSavedQueries.getSqlSavedQueriesStorageKey) {
        return window.SqlSavedQueries.getSqlSavedQueriesStorageKey(adminId);
      }
      return `zdex_admin_sql_saved_queries_${adminId}`;
    }

    _loadSqlSavedQueries() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) {
        this.sqlSavedQueriesState.queries = [];
        return;
      }
      if (window.SqlSavedQueries && window.SqlSavedQueries.loadSqlSavedQueries) {
        this.sqlSavedQueriesState.queries = window.SqlSavedQueries.loadSqlSavedQueries(localStorage, adminId);
      } else {
        try {
          const key = this._getSqlSavedQueriesStorageKey();
          if (!key) { this.sqlSavedQueriesState.queries = []; return; }
          const raw = localStorage.getItem(key);
          this.sqlSavedQueriesState.queries = raw ? JSON.parse(raw) : [];
        } catch (_) {
          this.sqlSavedQueriesState.queries = [];
        }
      }
    }

    _saveSqlSavedQueries() {
      const adminId = this._getCurrentAdminId();
      if (!adminId) return;
      if (window.SqlSavedQueries && window.SqlSavedQueries.saveSqlSavedQueries) {
        window.SqlSavedQueries.saveSqlSavedQueries(localStorage, adminId, this.sqlSavedQueriesState.queries);
      } else {
        try {
          const key = this._getSqlSavedQueriesStorageKey();
          if (key) localStorage.setItem(key, JSON.stringify(this.sqlSavedQueriesState.queries.slice(0, 100)));
        } catch (_) {}
      }
    }

    _renderSqlSavedQueries() {
      const wrap = document.getElementById('adminSqlSavedQueriesWrap');
      if (!wrap) return;

      if (!this._getCurrentAdminId()) {
        wrap.innerHTML = '';
        return;
      }

      wrap.innerHTML = `
        <div class="admin-sql-saved-queries-card">
          <div class="admin-sql-saved-queries-header">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <h3 style="margin:0;font-size:0.9375rem;font-weight:700;color:var(--admin-text-primary);display:flex;align-items:center;gap:0.5rem;">
                <span>Saved Queries</span>
                <span id="adminSqlSavedQueriesCountBadge" class="admin-badge admin-badge-neutral" style="font-family:var(--font-mono);font-size:0.75rem;">0 / 100</span>
              </h3>
              <span style="font-size:0.75rem;color:var(--admin-text-muted);" title="Saved Query SQL is administrator-authored data stored in browser-local storage. Browser storage is not a confidentiality boundary and may contain sensitive SQL literals.">(Per-administrator browser-local persistent definitions &bull; Max 100 queries)</span>
            </div>
            <div class="admin-sql-saved-queries-toolbar">
              <div class="admin-sql-search-box" style="width:240px;">
                ${ICONS.search || ''}
                <input type="text" id="adminSqlSavedQueriesSearchInput" class="admin-sql-search-input" placeholder="Search saved queries..." value="${this._escape(this.sqlSavedQueriesState.filterText)}" aria-label="Search saved queries">
              </div>
              <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._openSaveQueryModal()" title="Save current editor query definition">
                ${ICONS['file-text'] || ''} + Save Current Query
              </button>
            </div>
          </div>
          <div id="adminSqlSavedQueriesList" class="admin-sql-saved-queries-list"></div>
        </div>
      `;

      const searchInput = document.getElementById('adminSqlSavedQueriesSearchInput');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this._filterSqlSavedQueries(e.target.value);
        });
      }

      this._renderSqlSavedQueriesList();
    }

    _filterSqlSavedQueries(query) {
      this.sqlSavedQueriesState.filterText = (query || '').trim().toLowerCase();
      this._renderSqlSavedQueriesList();
    }

    _renderSqlSavedQueriesList() {
      const listEl = document.getElementById('adminSqlSavedQueriesList');
      const countBadge = document.getElementById('adminSqlSavedQueriesCountBadge');
      if (!listEl) return;

      if (!this._getCurrentAdminId()) {
        this.sqlSavedQueriesState.queries = [];
        this.sqlSavedQueriesState.expandedIds.clear();
        listEl.textContent = '';
        if (countBadge) countBadge.textContent = '0 / 100';
        return;
      }

      if (countBadge) {
        countBadge.textContent = `${this.sqlSavedQueriesState.queries.length} / 100`;
      }

      listEl.textContent = '';

      if (this.sqlSavedQueriesState.queries.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding:2.5rem 1.5rem;text-align:center;color:var(--admin-text-muted);font-size:0.875rem;';
        emptyDiv.textContent = 'No saved queries yet. Write a query in the editor and click "+ Save Current Query" to store reusable SQL definitions.';
        listEl.appendChild(emptyDiv);
        return;
      }

      const filterText = (this.sqlSavedQueriesState.filterText || '').toLowerCase();
      const filtered = (window.SqlSavedQueries && window.SqlSavedQueries.filterSqlSavedQueries)
        ? window.SqlSavedQueries.filterSqlSavedQueries(this.sqlSavedQueriesState.queries, filterText)
        : this.sqlSavedQueriesState.queries.filter(q => {
            if (!filterText) return true;
            const matchName = q.name && q.name.toLowerCase().includes(filterText);
            const matchDesc = q.description && q.description.toLowerCase().includes(filterText);
            const matchSql = q.sql && q.sql.toLowerCase().includes(filterText);
            return Boolean(matchName || matchDesc || matchSql);
          });

      if (filtered.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding:2rem;text-align:center;color:var(--admin-text-muted);font-size:0.875rem;';
        emptyDiv.textContent = 'No saved queries match your search filter.';
        listEl.appendChild(emptyDiv);
        return;
      }

      filtered.forEach(query => {
        const item = document.createElement('div');
        item.className = 'admin-sql-saved-query-item';

        // Top Row: Info and Actions
        const topRow = document.createElement('div');
        topRow.className = 'admin-sql-saved-query-item-top';

        // Info (Left)
        const infoDiv = document.createElement('div');
        infoDiv.className = 'admin-sql-saved-query-info';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'admin-sql-saved-query-name';
        nameSpan.textContent = query.name;
        infoDiv.appendChild(nameSpan);

        if (query.description) {
          const descSpan = document.createElement('div');
          descSpan.className = 'admin-sql-saved-query-desc';
          descSpan.textContent = query.description;
          infoDiv.appendChild(descSpan);
        }

        const metaSpan = document.createElement('div');
        metaSpan.className = 'admin-sql-saved-query-meta';
        const updatedDate = new Date(query.updatedAt || query.createdAt);
        metaSpan.textContent = `Updated: ${updatedDate.toLocaleDateString()} ${updatedDate.toLocaleTimeString()}`;
        metaSpan.title = `Created: ${new Date(query.createdAt).toLocaleString()} | Updated: ${updatedDate.toLocaleString()}`;
        infoDiv.appendChild(metaSpan);

        topRow.appendChild(infoDiv);

        // Actions (Right)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'admin-sql-saved-query-actions';

        // Restore Button
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        restoreBtn.title = 'Load query into editor (does not execute)';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', () => this._restoreSavedQuery(query.id));
        actionsDiv.appendChild(restoreBtn);

        // Copy SQL Button
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        copyBtn.title = 'Copy SQL definition to clipboard';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => this._copySavedQuerySql(query.id));
        actionsDiv.appendChild(copyBtn);

        // Edit Button
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        editBtn.title = 'Edit saved query definition';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => this._openSaveQueryModal(query.id));
        actionsDiv.appendChild(editBtn);

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        deleteBtn.title = 'Delete saved query';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => this.confirmDeleteSavedQuery(query.id));
        actionsDiv.appendChild(deleteBtn);

        // Details Toggle
        const isExpanded = this.sqlSavedQueriesState.expandedIds.has(query.id);
        const detailsBtn = document.createElement('button');
        detailsBtn.type = 'button';
        detailsBtn.className = 'admin-btn admin-btn-secondary admin-btn-xs';
        detailsBtn.title = isExpanded ? 'Collapse SQL' : 'Expand full SQL definition';
        detailsBtn.textContent = isExpanded ? 'SQL ▲' : 'SQL ▼';
        detailsBtn.addEventListener('click', () => this._toggleSavedQueryDetails(query.id));
        actionsDiv.appendChild(detailsBtn);

        topRow.appendChild(actionsDiv);
        item.appendChild(topRow);

        // One-line SQL Preview (clickable to restore)
        const previewDiv = document.createElement('div');
        previewDiv.className = 'admin-sql-saved-query-sql-preview';
        previewDiv.title = 'Click to restore query into editor';
        const singleLineSql = query.sql.replace(/\s+/g, ' ');
        previewDiv.textContent = singleLineSql.length > 140 ? singleLineSql.substring(0, 140) + '...' : singleLineSql;
        previewDiv.addEventListener('click', () => this._restoreSavedQuery(query.id));
        item.appendChild(previewDiv);

        // Expanded View
        if (isExpanded) {
          const fullSqlPre = document.createElement('pre');
          fullSqlPre.className = 'admin-sql-saved-query-expanded-sql';
          fullSqlPre.textContent = query.sql;
          item.appendChild(fullSqlPre);
        }

        listEl.appendChild(item);
      });
    }

    _restoreSavedQuery(id) {
      if (!this._getCurrentAdminId()) {
        this.sqlSavedQueriesState.queries = [];
        this.sqlSavedQueriesState.expandedIds.clear();
        this.toast('Authentication required to access saved queries.', 'warning');
        return;
      }

      const query = this.sqlSavedQueriesState.queries.find(q => q.id === id);
      if (!query || !query.sql) {
        this.toast('Saved query not found.', 'warning');
        return;
      }

      const input = document.getElementById('adminSqlQueryInput');
      if (input) {
        input.value = query.sql;
        this._updateSqlEditorGutter();
        this._updateSqlCursorPos();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
        this.toast(`Saved query "${query.name}" restored to editor (not executed).`, 'info', 2500);
      }
    }

    _copySavedQuerySql(id) {
      if (!this._getCurrentAdminId()) return;
      const query = this.sqlSavedQueriesState.queries.find(q => q.id === id);
      if (!query || !query.sql) return;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(query.sql).then(() => {
          this.toast(`SQL for "${query.name}" copied to clipboard.`, 'success', 2000);
        }).catch(() => {
          this.toast('Failed to copy SQL to clipboard.', 'danger');
        });
      } else {
        this.toast('Clipboard API unavailable in this browser.', 'warning');
      }
    }

    _toggleSavedQueryDetails(id) {
      if (this.sqlSavedQueriesState.expandedIds.has(id)) {
        this.sqlSavedQueriesState.expandedIds.delete(id);
      } else {
        this.sqlSavedQueriesState.expandedIds.add(id);
      }
      this._renderSqlSavedQueriesList();
    }

    _openSaveQueryModal(idToEdit = null) {
      const adminId = this._getCurrentAdminId();
      if (!adminId) {
        this.toast('Authentication required to save queries.', 'warning');
        return;
      }

      let existing = null;
      let initialSql = '';
      if (idToEdit) {
        existing = this.sqlSavedQueriesState.queries.find(q => q.id === idToEdit);
        if (!existing) {
          this.toast('Saved query not found.', 'warning');
          return;
        }
        initialSql = existing.sql;
      } else {
        const editorInput = document.getElementById('adminSqlQueryInput');
        initialSql = editorInput ? editorInput.value.trim() : '';
        if (!initialSql) {
          this.toast('Please write or enter a SQL query in the editor first.', 'warning');
          if (editorInput) editorInput.focus();
          return;
        }
      }

      const formContainer = document.createElement('div');
      formContainer.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;';

      // Security Notice
      const noticeDiv = document.createElement('div');
      noticeDiv.className = 'admin-banner-info';
      noticeDiv.style.cssText = 'padding:0.625rem 0.875rem;font-size:0.75rem;line-height:1.4;background:var(--admin-bg-subtle);border-radius:var(--radius-sm);border:1px solid var(--admin-border-subtle);';
      noticeDiv.textContent = 'Saved Query definitions are retained in browser-local storage for your administrator profile. Stored SQL may contain sensitive literals.';
      formContainer.appendChild(noticeDiv);

      // Name Input
      const nameGroup = document.createElement('div');
      nameGroup.style.cssText = 'display:flex;flex-direction:column;gap:0.375rem;';
      const nameLabel = document.createElement('label');
      nameLabel.style.cssText = 'font-size:0.8125rem;font-weight:600;color:var(--admin-text-primary);';
      nameLabel.textContent = 'Query Name *';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'admin-search-input';
      nameInput.style.cssText = 'padding:0.5rem 0.75rem;font-size:0.875rem;';
      nameInput.placeholder = 'e.g. Active Customer Accounts';
      nameInput.maxLength = 100;
      nameInput.value = existing ? existing.name : '';
      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInput);
      formContainer.appendChild(nameGroup);

      // Description Input
      const descGroup = document.createElement('div');
      descGroup.style.cssText = 'display:flex;flex-direction:column;gap:0.375rem;';
      const descLabel = document.createElement('label');
      descLabel.style.cssText = 'font-size:0.8125rem;font-weight:600;color:var(--admin-text-primary);';
      descLabel.textContent = 'Description (Optional)';
      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'admin-search-input';
      descInput.style.cssText = 'padding:0.5rem 0.75rem;font-size:0.875rem;';
      descInput.placeholder = 'e.g. Returns verified active customer accounts ordered by creation date';
      descInput.maxLength = 500;
      descInput.value = existing && existing.description ? existing.description : '';
      descGroup.appendChild(descLabel);
      descGroup.appendChild(descInput);
      formContainer.appendChild(descGroup);

      // SQL Textarea
      const sqlGroup = document.createElement('div');
      sqlGroup.style.cssText = 'display:flex;flex-direction:column;gap:0.375rem;';
      const sqlLabel = document.createElement('label');
      sqlLabel.style.cssText = 'font-size:0.8125rem;font-weight:600;color:var(--admin-text-primary);';
      sqlLabel.textContent = 'SQL Statement *';
      const sqlTextarea = document.createElement('textarea');
      sqlTextarea.className = 'admin-sql-textarea';
      sqlTextarea.style.cssText = 'font-family:var(--font-mono);font-size:0.8125rem;padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);min-height:140px;background:var(--admin-bg-base);';
      sqlTextarea.maxLength = 10000;
      sqlTextarea.spellcheck = false;
      sqlTextarea.value = initialSql;
      sqlGroup.appendChild(sqlLabel);
      sqlGroup.appendChild(sqlTextarea);
      formContainer.appendChild(sqlGroup);

      // Actions row
      const actionsRow = document.createElement('div');
      actionsRow.style.cssText = 'display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'admin-btn admin-btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        const drawerBackdrop = document.getElementById('adminDrawerBackdrop');
        const drawer = document.getElementById('adminDrawer');
        if (drawer) drawer.classList.remove('open');
        if (drawerBackdrop) drawerBackdrop.classList.remove('active');
      });
      actionsRow.appendChild(cancelBtn);

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'admin-btn admin-btn-primary';
      submitBtn.textContent = existing ? 'Update Saved Query' : 'Save Query';
      submitBtn.addEventListener('click', () => {
        const nameVal = nameInput.value.trim();
        const sqlVal = sqlTextarea.value.trim();
        const descVal = descInput.value.trim();

        if (!nameVal) {
          this.toast('Please enter a query name.', 'warning');
          nameInput.focus();
          return;
        }

        if (!sqlVal) {
          this.toast('Please enter a SQL statement.', 'warning');
          sqlTextarea.focus();
          return;
        }

        try {
          if (existing) {
            window.SqlSavedQueries.updateSqlSavedQuery(localStorage, adminId, existing.id, {
              name: nameVal,
              description: descVal || null,
              sql: sqlVal
            });
            this.toast(`Saved query "${nameVal}" updated successfully.`, 'success');
          } else {
            window.SqlSavedQueries.createSqlSavedQuery(localStorage, adminId, {
              name: nameVal,
              description: descVal || null,
              sql: sqlVal
            });
            this.toast(`Query "${nameVal}" saved successfully.`, 'success');
          }

          this._loadSqlSavedQueries();
          this._renderSqlSavedQueriesList();

          const drawerBackdrop = document.getElementById('adminDrawerBackdrop');
          const drawer = document.getElementById('adminDrawer');
          if (drawer) drawer.classList.remove('open');
          if (drawerBackdrop) drawerBackdrop.classList.remove('active');
        } catch (err) {
          const msg = err && err.message ? err.message : 'Failed to save query';
          this.toast(msg, 'danger');
        }
      });
      actionsRow.appendChild(submitBtn);

      formContainer.appendChild(actionsRow);

      this._showDrawer(existing ? 'Edit Saved Query' : 'Save Query Definition', formContainer);
      setTimeout(() => nameInput.focus(), 150);
    }

    confirmDeleteSavedQuery(id) {
      const adminId = this._getCurrentAdminId();
      if (!adminId) {
        this.toast('Authentication required to delete saved queries.', 'warning');
        return;
      }

      const query = this.sqlSavedQueriesState.queries.find(q => q.id === id);
      if (!query) {
        this.toast('Saved query not found.', 'warning');
        return;
      }

      this.showConfirmModal({
        title: 'Delete Saved Query',
        message: `Are you sure you want to delete the saved query "${query.name}"?`,
        warningText: 'This definition will be permanently deleted from your saved queries list. Query History and backend audit logs are not affected.',
        confirmLabel: 'Delete Query',
        confirmType: 'danger',
        requireReason: false,
        onConfirm: () => {
          const deleted = window.SqlSavedQueries.deleteSqlSavedQuery(localStorage, adminId, id);
          if (deleted) {
            this._loadSqlSavedQueries();
            this._renderSqlSavedQueriesList();
            this.toast(`Saved query "${query.name}" deleted.`, 'success');
          } else {
            this.toast('Failed to delete saved query.', 'danger');
          }
        }
      });
    }

    confirmClearSqlHistory() {
      if (!this.sqlHistoryState.entries || this.sqlHistoryState.entries.length === 0) {
        this.toast('Query history is already empty.', 'info');
        return;
      }

      this.showConfirmModal({
        title: 'Clear Local Query History',
        message: `Are you sure you want to clear your local SQL query history (${this.sqlHistoryState.entries.length} queries)?`,
        warningText: 'This only clears your local browser history. Tamper-evident, hash-chained platform security audit logs are not affected.',
        confirmLabel: 'Clear History',
        confirmType: 'danger',
        requireReason: false,
        onConfirm: () => {
          const adminId = this._getCurrentAdminId();
          if (window.SqlHistory && window.SqlHistory.clearSqlHistory && adminId) {
            window.SqlHistory.clearSqlHistory(localStorage, adminId);
          } else {
            const key = this._getSqlHistoryStorageKey();
            if (key) localStorage.removeItem(key);
          }
          this.sqlHistoryState.entries = [];
          this.sqlHistoryState.expandedIds.clear();
          this._renderSqlHistoryList();
          this.toast('Local SQL query history cleared.', 'success');
        }
      });
    }

    _wipeHistoryStateOnLogout() {
      this.sqlHistoryState.entries = [];
      this.sqlHistoryState.expandedIds.clear();
      this.sqlHistoryState.filterText = '';
      this.sqlHistoryState.statusFilter = 'ALL';
      if (this.sqlSavedQueriesState) {
        this.sqlSavedQueriesState.queries = [];
        this.sqlSavedQueriesState.expandedIds.clear();
        this.sqlSavedQueriesState.filterText = '';
      }
    }

    /* =========================================================================
       PHASE 15 BATCH 15.1: DATABASE MANAGEMENT FOUNDATION
       ========================================================================= */
    async _renderDatabaseManagementView(container) {
      if (!container) return;

      container.innerHTML = `
        <div class="admin-db-container">
          <div class="admin-view-header">
            <div class="admin-view-title-wrap">
              <h1>Database Management</h1>
              <p>Authoritative MySQL schema topology, dynamic table discovery, structural metadata, and bounded read-only record browsing.</p>
            </div>
            <div class="admin-header-actions">
              <button class="admin-btn admin-btn-secondary admin-btn-sm" id="btnRefreshDbOverview" onclick="AdminShell._refreshDatabaseView()">
                ${ICONS['rotate-ccw'] || ''} Refresh Schema
              </button>
            </div>
          </div>

          <!-- Overview Metric Cards -->
          <div class="admin-db-metrics-grid" id="adminDbMetricsGrid">
            <div class="admin-db-metric-card">
              <div class="admin-db-metric-header">
                <span>Database Instance</span>
                <span class="admin-badge admin-badge-success" style="font-size:0.6875rem;">CONNECTED</span>
              </div>
              <div class="admin-db-metric-value" id="dbOverviewName">...</div>
              <div class="admin-db-metric-subtext" id="dbOverviewEngine">MySQL Engine • InnoDB Storage</div>
            </div>
            <div class="admin-db-metric-card">
              <div class="admin-db-metric-header">
                <span>Physical Tables</span>
                <span class="admin-badge admin-badge-info" id="dbOverviewTableCountBadge" style="font-size:0.6875rem;">0 Total</span>
              </div>
              <div class="admin-db-metric-value" id="dbOverviewTableCount">0</div>
              <div class="admin-db-metric-subtext" id="dbOverviewClassBreakdown">Loading classifications...</div>
            </div>
            <div class="admin-db-metric-card">
              <div class="admin-db-metric-header">
                <span>Estimated Volume</span>
                <span class="admin-badge admin-badge-neutral" style="font-size:0.6875rem;">DATA & INDEX</span>
              </div>
              <div class="admin-db-metric-value" id="dbOverviewRowCount">0</div>
              <div class="admin-db-metric-subtext" id="dbOverviewStorageSize">0 KB estimated storage</div>
            </div>
          </div>

          <!-- Main Two-Column Layout -->
          <div class="admin-db-layout">
            <!-- Left Sidebar Table Explorer -->
            <div class="admin-db-sidebar">
              <div class="admin-db-sidebar-header">
                <div class="admin-db-sidebar-title">
                  <span>Schema Explorer</span>
                  <span class="admin-badge admin-badge-neutral" id="dbTableFilterCount" style="font-size:0.6875rem;">0 tables</span>
                </div>
                <input type="text" class="admin-db-search-input" id="dbTableSearchInput" placeholder="Filter tables by name..." oninput="AdminShell._onDbTableSearchInput(this.value)" />
                <div class="admin-db-filter-chips">
                  <button class="admin-db-filter-chip active" data-filter="ALL" onclick="AdminShell._setDbClassificationFilter('ALL')">All</button>
                  <button class="admin-db-filter-chip" data-filter="APPROVED_LEAF" onclick="AdminShell._setDbClassificationFilter('APPROVED_LEAF')">Leaf</button>
                  <button class="admin-db-filter-chip" data-filter="NON_LEAF" onclick="AdminShell._setDbClassificationFilter('NON_LEAF')">Non-Leaf</button>
                  <button class="admin-db-filter-chip" data-filter="BUSINESS_SENSITIVE" onclick="AdminShell._setDbClassificationFilter('BUSINESS_SENSITIVE')">Sensitive</button>
                  <button class="admin-db-filter-chip" data-filter="PROTECTED" onclick="AdminShell._setDbClassificationFilter('PROTECTED')">Protected</button>
                  <button class="admin-db-filter-chip" data-filter="INTERNAL" onclick="AdminShell._setDbClassificationFilter('INTERNAL')">Internal</button>
                </div>
              </div>
              <div class="admin-db-table-list" id="dbTableListContainer">
                <div class="admin-loading-state" style="padding: 2rem 1rem; text-align: center; color: var(--admin-text-muted); font-size: 0.8125rem;">
                  Loading schema tables...
                </div>
              </div>
            </div>

            <!-- Right Detail & Preview Area -->
            <div class="admin-db-main" id="dbMainAreaContainer">
              <div class="admin-db-empty-state">
                <div class="admin-db-empty-state-icon">${ICONS.database || ''}</div>
                <h3 style="margin:0; font-size:1rem; color:var(--admin-text-primary);">Select a Table</h3>
                <p style="margin:0; font-size:0.8125rem; max-width:360px;">Choose a database table from the schema explorer to inspect its columns, indexes, foreign key relationships, and browse bounded records.</p>
              </div>
            </div>
          </div>
        </div>
      `;

      // Load initial data
      this._loadDatabaseOverview();
      this._loadDatabaseTables();
    }

    async _refreshDatabaseView() {
      this.toast('Refreshing database topology and schema...', 'info');
      await Promise.all([
        this._loadDatabaseOverview(),
        this._loadDatabaseTables()
      ]);
      if (this.dbManagementState.selectedTable) {
        await this._loadTableDetails(this.dbManagementState.selectedTable);
        if (this.dbManagementState.activeTab === 'preview') {
          await this._loadTablePreview(this.dbManagementState.selectedTable, this.dbManagementState.previewOffset);
        }
      }
      this.toast('Schema and metadata refreshed successfully.', 'success');
    }

    async _loadDatabaseOverview() {
      try {
        this.dbManagementState.isLoadingOverview = true;
        const res = await window.AdminApi.getDatabaseOverview();
        if (res && res.success && res.data) {
          this.dbManagementState.overview = res.data;
          this._renderDbOverviewCards(res.data);
        }
      } catch (err) {
        console.error('Failed to load database overview:', err);
      } finally {
        this.dbManagementState.isLoadingOverview = false;
      }
    }

    _renderDbOverviewCards(overview) {
      const nameEl = document.getElementById('dbOverviewName');
      const engineEl = document.getElementById('dbOverviewEngine');
      const tableCountEl = document.getElementById('dbOverviewTableCount');
      const tableCountBadge = document.getElementById('dbOverviewTableCountBadge');
      const breakdownEl = document.getElementById('dbOverviewClassBreakdown');
      const rowCountEl = document.getElementById('dbOverviewRowCount');
      const storageSizeEl = document.getElementById('dbOverviewStorageSize');

      if (nameEl) nameEl.textContent = overview.databaseName || 'zdexcloud';
      if (engineEl) engineEl.textContent = `${overview.serverVersion || 'MySQL 8.0'} • InnoDB Engine`;
      if (tableCountEl) tableCountEl.textContent = String(overview.totalTables || 0);
      if (tableCountBadge) tableCountBadge.textContent = `${overview.totalTables || 0} Tables`;

      if (breakdownEl && overview.classificationCounts) {
        const counts = overview.classificationCounts;
        breakdownEl.innerHTML = `
          <span title="Approved Leaf Tables" style="color:#059669; font-weight:600;">${counts.APPROVED_LEAF || 0} Leaf</span> •
          <span title="Non-Leaf Tables" style="color:#d97706; font-weight:600;">${counts.NON_LEAF || 0} Non-Leaf</span> •
          <span title="Protected System Tables" style="color:#dc2626; font-weight:600;">${counts.PROTECTED || 0} Protected</span> •
          <span title="Business-Sensitive Financial Tables" style="color:#7c3aed; font-weight:600;">${counts.BUSINESS_SENSITIVE || 0} Sensitive</span>
        `;
      }

      if (rowCountEl) {
        const formattedRows = (overview.totalEstimatedRows || 0).toLocaleString();
        rowCountEl.textContent = `~${formattedRows} rows`;
      }

      if (storageSizeEl) {
        const totalBytes = (overview.totalDataSizeBytes || 0) + (overview.totalIndexSizeBytes || 0);
        const mb = (totalBytes / (1024 * 1024)).toFixed(2);
        storageSizeEl.textContent = `~${mb} MB allocated storage`;
      }
    }

    async _loadDatabaseTables() {
      try {
        this.dbManagementState.isLoadingTables = true;
        const res = await window.AdminApi.getDatabaseTables();
        if (res && res.success && res.data) {
          this.dbManagementState.tables = res.data;
          this._renderDbTableList();
        }
      } catch (err) {
        console.error('Failed to load database tables:', err);
        const listEl = document.getElementById('dbTableListContainer');
        if (listEl) {
          listEl.innerHTML = `
            <div class="admin-error-banner" style="margin:1rem; padding:0.75rem; font-size:0.75rem;">
              Failed to load schema tables. <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._loadDatabaseTables()">Retry</button>
            </div>
          `;
        }
      } finally {
        this.dbManagementState.isLoadingTables = false;
      }
    }

    _onDbTableSearchInput(val) {
      this.dbManagementState.filterText = (val || '').trim().toLowerCase();
      this._renderDbTableList();
    }

    _setDbClassificationFilter(filter) {
      this.dbManagementState.classificationFilter = filter;
      const chips = document.querySelectorAll('.admin-db-filter-chip');
      chips.forEach(chip => {
        if (chip.getAttribute('data-filter') === filter) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
      this._renderDbTableList();
    }

    _renderDbTableList() {
      const container = document.getElementById('dbTableListContainer');
      const countBadge = document.getElementById('dbTableFilterCount');
      if (!container) return;

      const tables = this.dbManagementState.tables || [];
      const filterText = this.dbManagementState.filterText;
      const classFilter = this.dbManagementState.classificationFilter;

      const filtered = tables.filter(t => {
        const matchesText = !filterText ||
          t.tableName.toLowerCase().includes(filterText) ||
          (t.displayName && t.displayName.toLowerCase().includes(filterText));
        const matchesClass = classFilter === 'ALL' || t.classification === classFilter;
        return matchesText && matchesClass;
      });

      if (countBadge) {
        countBadge.textContent = `${filtered.length} of ${tables.length} tables`;
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="padding: 2rem 1rem; text-align: center; color: var(--admin-text-muted); font-size: 0.8125rem;">
            No tables matching filter
          </div>
        `;
        return;
      }

      const selectedTable = this.dbManagementState.selectedTable;

      container.innerHTML = filtered.map(t => {
        const isSelected = t.tableName === selectedTable;
        const rowEstimateFormatted = Number(t.rowCountEstimate || 0).toLocaleString();
        return `
          <div class="admin-db-table-item ${isSelected ? 'active' : ''}" onclick="AdminShell._selectDbTable('${this._escape(t.tableName)}')">
            <div class="admin-db-table-item-name">
              <span>${this._escape(t.tableName)}</span>
              <span class="admin-db-badge-chip ${t.classification}">${t.classification.replace('_', ' ')}</span>
            </div>
            <div class="admin-db-table-item-meta">
              <span>${t.columnCount} columns • ~${rowEstimateFormatted} rows</span>
              <span>${(Number(t.dataSizeBytes || 0) / 1024).toFixed(0)} KB</span>
            </div>
          </div>
        `;
      }).join('');
    }

    async _selectDbTable(tableName) {
      this.dbManagementState.selectedTable = tableName;
      this.dbManagementState.previewOffset = 0;
      this._renderDbTableList();
      await this._loadTableDetails(tableName);
      if (this.dbManagementState.activeTab === 'preview') {
        await this._loadTablePreview(tableName, 0);
      }
    }

    async _loadTableDetails(tableName) {
      const mainArea = document.getElementById('dbMainAreaContainer');
      if (!mainArea) return;

      try {
        this.dbManagementState.isLoadingDetails = true;
        this._renderDbTableMainSkeleton(tableName);

        const res = await window.AdminApi.getTableDetails(tableName);
        if (res && res.success && res.data) {
          this.dbManagementState.tableDetails = res.data;
          this._renderDbTableMain();
        }
      } catch (err) {
        console.error('Failed to load table details:', err);
        mainArea.innerHTML = `
          <div class="admin-error-banner" style="margin:2rem; padding:1.25rem;">
            <strong>Failed to load details for table '${this._escape(tableName)}'.</strong>
            <p style="margin:0.5rem 0 0 0; font-size:0.8125rem;">${this._escape(err.message || 'Error communicating with database.')}</p>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" style="margin-top:0.75rem;" onclick="AdminShell._selectDbTable('${this._escape(tableName)}')">Retry</button>
          </div>
        `;
      } finally {
        this.dbManagementState.isLoadingDetails = false;
      }
    }

    _renderDbTableMainSkeleton(tableName) {
      const mainArea = document.getElementById('dbMainAreaContainer');
      if (!mainArea) return;

      mainArea.innerHTML = `
        <div class="admin-db-main-header">
          <div class="admin-db-main-title-row">
            <div class="admin-db-main-title">
              <span>${this._escape(tableName)}</span>
              <span class="admin-badge admin-badge-neutral">Loading...</span>
            </div>
          </div>
        </div>
        <div class="admin-loading-state" style="padding: 4rem 2rem; text-align: center; color: var(--admin-text-muted);">
          Introspecting table structure and metadata...
        </div>
      `;
    }

    _renderDbTableMain() {
      const mainArea = document.getElementById('dbMainAreaContainer');
      const details = this.dbManagementState.tableDetails;
      if (!mainArea || !details) return;

      const activeTab = this.dbManagementState.activeTab || 'grid';
      const exactRowsFormatted = details.exactRowCount !== null ? details.exactRowCount.toLocaleString() : null;
      const estimateRowsFormatted = Number(details.rowCountEstimate || 0).toLocaleString();

      mainArea.innerHTML = `
        <div class="admin-db-main-header">
          <div class="admin-db-main-title-row">
            <div class="admin-db-main-title">
              <span>${this._escape(details.tableName)}</span>
              <span class="admin-db-badge-chip ${details.classification}">${details.classification.replace('_', ' ')}</span>
              <span class="admin-badge admin-badge-neutral" style="font-size:0.6875rem;">${details.engine}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._copyText('${this._escape(details.tableName)}')">
                ${ICONS.copy || ''} Copy Name
              </button>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._openInSqlRunner('${this._escape(details.tableName)}')">
                ${ICONS.database || ''} Open in SQL Runner
              </button>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:1.25rem; font-size:0.75rem; color:var(--admin-text-secondary); flex-wrap:wrap;">
            <span><strong>Primary Keys:</strong> ${details.primaryKeys && details.primaryKeys.length > 0 ? details.primaryKeys.map(pk => `<code style="background:var(--admin-bg-base); padding:0.1rem 0.35rem; border-radius:3px;">${this._escape(pk)}</code>`).join(', ') : '<em>None</em>'}</span>
            <span><strong>Columns:</strong> ${details.columns ? details.columns.length : 0}</span>
            <span><strong>Row Count:</strong> ${exactRowsFormatted !== null ? `${exactRowsFormatted} (Exact)` : `~${estimateRowsFormatted} (Estimate)`}</span>
            <span><strong>Size:</strong> ${(Number(details.dataSizeBytes || 0) / 1024).toFixed(1)} KB</span>
            <span><strong>Incoming FKs:</strong> ${details.incomingForeignKeyCount} references</span>
          </div>
        </div>

        <div class="admin-db-nav-tabs">
          <div class="admin-db-nav-tab ${activeTab === 'grid' ? 'active' : ''}" onclick="AdminShell._switchDbTab('grid')">
            Data Grid (Server Paginated)
          </div>
          <div class="admin-db-nav-tab ${activeTab === 'columns' ? 'active' : ''}" onclick="AdminShell._switchDbTab('columns')">
            Columns & Types (${details.columns ? details.columns.length : 0})
          </div>
          <div class="admin-db-nav-tab ${activeTab === 'indexes' ? 'active' : ''}" onclick="AdminShell._switchDbTab('indexes')">
            Indexes & Constraints (${(details.indexes ? details.indexes.length : 0) + (details.foreignKeys ? details.foreignKeys.length : 0)})
          </div>
        </div>

        <div class="admin-db-tab-content" id="dbTabContentArea">
          <!-- Populated by _renderDbTabContent -->
        </div>
      `;

      this._renderDbTabContent();
    }

    _switchDbTab(tab) {
      this.dbManagementState.activeTab = tab;
      const tabs = document.querySelectorAll('.admin-db-nav-tab');
      tabs.forEach(t => t.classList.remove('active'));

      const tabsContainer = document.querySelector('.admin-db-nav-tabs');
      if (tabsContainer) {
        const tabEls = tabsContainer.children;
        if (tab === 'grid' && tabEls[0]) tabEls[0].classList.add('active');
        if (tab === 'columns' && tabEls[1]) tabEls[1].classList.add('active');
        if (tab === 'indexes' && tabEls[2]) tabEls[2].classList.add('active');
      }

      this._renderDbTabContent();

      if (tab === 'grid' && !this.dbManagementState.gridData && this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    async _selectDbTable(tableName) {
      this.dbManagementState.selectedTable = tableName;
      this.dbManagementState.page = 1;
      this.dbManagementState.searchQuery = '';
      this.dbManagementState.filters = [];
      this.dbManagementState.gridData = null;
      // Switching tables unconditionally clears row selection
      this.dbManagementState.selectedRowKeys.clear();
      this.dbManagementState.selectedRowsMeta.clear();
      this._renderDbTableList();
      await this._loadTableDetails(tableName);
      if (this.dbManagementState.activeTab === 'grid') {
        await this._loadDbGridRows(tableName, true);
      }
    }

    async _renderDbTabContent() {
      const container = document.getElementById('dbTabContentArea');
      const details = this.dbManagementState.tableDetails;
      const tab = this.dbManagementState.activeTab;
      if (!container || !details) return;

      if (tab === 'columns') {
        container.innerHTML = `
          <div class="admin-db-table-wrapper">
            <table class="admin-db-data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Column Name</th>
                  <th>Data Type</th>
                  <th>Nullable</th>
                  <th>Key</th>
                  <th>Default</th>
                  <th>Extra / Attributes</th>
                </tr>
              </thead>
              <tbody>
                ${(details.columns || []).map(col => `
                  <tr>
                    <td style="color:var(--admin-text-muted);">${col.ordinalPosition}</td>
                    <td style="font-weight:600; color:var(--admin-text-primary);">
                      ${this._escape(col.name)}
                      ${col.isPrimaryKey ? '<span class="admin-badge admin-badge-warning" style="font-size:0.625rem; margin-left:0.35rem;">PK</span>' : ''}
                    </td>
                    <td><code style="color:#2563eb;">${this._escape(col.columnType || col.dataType)}</code></td>
                    <td>${col.isNullable ? '<span class="admin-badge admin-badge-neutral" style="font-size:0.625rem;">YES</span>' : '<span class="admin-badge admin-badge-info" style="font-size:0.625rem;">NO</span>'}</td>
                    <td>${col.isPrimaryKey ? 'PRIMARY' : (col.columnKey || '-')}</td>
                    <td style="color:var(--admin-text-secondary);">${col.columnDefault !== null ? this._escape(String(col.columnDefault)) : '<em>NULL</em>'}</td>
                    <td style="color:var(--admin-text-muted);">${col.extra ? this._escape(col.extra) : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else if (tab === 'indexes') {
        container.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:1.25rem;">
            <div>
              <h4 style="margin:0 0 0.5rem 0; font-size:0.875rem; color:var(--admin-text-primary);">Indexes (${details.indexes ? details.indexes.length : 0})</h4>
              <div class="admin-db-table-wrapper">
                <table class="admin-db-data-table">
                  <thead>
                    <tr>
                      <th>Index Name</th>
                      <th>Type</th>
                      <th>Unique</th>
                      <th>Indexed Columns</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(details.indexes || []).map(idx => `
                      <tr>
                        <td style="font-weight:600;">${this._escape(idx.name)}</td>
                        <td><code>${this._escape(idx.type)}</code></td>
                        <td>${idx.isUnique ? '<span class="admin-badge admin-badge-success" style="font-size:0.625rem;">UNIQUE</span>' : '<span class="admin-badge admin-badge-neutral" style="font-size:0.625rem;">INDEX</span>'}</td>
                        <td>${idx.columns.map(c => `<code>${this._escape(c)}</code>`).join(', ')}</td>
                      </tr>
                    `).join('')}
                    ${(!details.indexes || details.indexes.length === 0) ? '<tr><td colspan="4" style="text-align:center; color:var(--admin-text-muted);">No indexes defined</td></tr>' : ''}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 style="margin:0 0 0.5rem 0; font-size:0.875rem; color:var(--admin-text-primary);">Foreign Key Constraints (${details.foreignKeys ? details.foreignKeys.length : 0})</h4>
              <div class="admin-db-table-wrapper">
                <table class="admin-db-data-table">
                  <thead>
                    <tr>
                      <th>Constraint Name</th>
                      <th>Column</th>
                      <th>Referenced Table</th>
                      <th>Referenced Column</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(details.foreignKeys || []).map(fk => `
                      <tr>
                        <td>${this._escape(fk.constraintName)}</td>
                        <td style="font-weight:600;"><code>${this._escape(fk.columnName)}</code></td>
                        <td style="color:#7c3aed; font-weight:600;">${this._escape(fk.referencedTable)}</td>
                        <td><code>${this._escape(fk.referencedColumn)}</code></td>
                      </tr>
                    `).join('')}
                    ${(!details.foreignKeys || details.foreignKeys.length === 0) ? '<tr><td colspan="4" style="text-align:center; color:var(--admin-text-muted);">No outbound foreign key relationships</td></tr>' : ''}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else {
        // Data Grid Tab
        this._renderDbGridContent(container);
      }
    }

    /* =========================================================================
       Phase 15 Batch 15.3: Canonical Row Identity & Selection Helpers
       ========================================================================= */

    _getCanonicalRowKey(tableName, primaryKeys, row, rowIndex, page) {
      if (primaryKeys && Array.isArray(primaryKeys) && primaryKeys.length > 0) {
        const sortedKeys = [...primaryKeys].sort();
        const pkObj = {};
        for (const pk of sortedKeys) {
          pkObj[pk] = (row[pk] !== undefined && row[pk] !== null) ? String(row[pk]) : '';
        }
        return JSON.stringify({ t: tableName, k: pkObj });
      }
      return JSON.stringify({ t: tableName, nopk: true, p: page || 1, i: rowIndex });
    }

    _getRowIdentityMeta(tableName, primaryKeys, row, rowIndex, page) {
      if (primaryKeys && Array.isArray(primaryKeys) && primaryKeys.length > 0) {
        const sortedKeys = [...primaryKeys].sort();
        const pkObj = {};
        for (const pk of sortedKeys) {
          pkObj[pk] = (row[pk] !== undefined && row[pk] !== null) ? String(row[pk]) : '';
        }
        return {
          table: tableName,
          primaryKey: pkObj,
          noPrimaryKey: false
        };
      }
      return {
        table: tableName,
        primaryKey: null,
        noPrimaryKey: true,
        page: page || 1,
        rowIndex: rowIndex
      };
    }

    _checkNoPkReset() {
      const details = this.dbManagementState.tableDetails;
      const isNoPk = !details?.primaryKeys || details.primaryKeys.length === 0;
      if (isNoPk && this.dbManagementState.selectedRowKeys.size > 0) {
        this.dbManagementState.selectedRowKeys.clear();
        this.dbManagementState.selectedRowsMeta.clear();
      }
    }

    _onRowCheckboxChange(checkboxEl, canonicalKey) {
      const isChecked = checkboxEl.checked;
      if (isChecked) {
        if (this.dbManagementState.selectedRowKeys.size >= this.dbManagementState.selectionLimit) {
          checkboxEl.checked = false;
          this.toast(`Selection limit reached (${this.dbManagementState.selectionLimit} rows). Clear some selections before selecting more.`, 'warning');
          return;
        }
        this.dbManagementState.selectedRowKeys.add(canonicalKey);

        const gridData = this.dbManagementState.gridData;
        const details = this.dbManagementState.tableDetails;
        if (gridData && details) {
          const primaryKeys = gridData.primaryKeys || details.primaryKeys || [];
          const page = gridData.pagination?.page || this.dbManagementState.page || 1;
          const rows = gridData.rows || [];
          for (let i = 0; i < rows.length; i++) {
            const k = this._getCanonicalRowKey(details.tableName, primaryKeys, rows[i], i, page);
            if (k === canonicalKey) {
              const meta = this._getRowIdentityMeta(details.tableName, primaryKeys, rows[i], i, page);
              this.dbManagementState.selectedRowsMeta.set(canonicalKey, meta);
              break;
            }
          }
        }
      } else {
        this.dbManagementState.selectedRowKeys.delete(canonicalKey);
        this.dbManagementState.selectedRowsMeta.delete(canonicalKey);
      }
      this._updateGridSelectionUI();
    }

    _toggleSelectAllVisible() {
      const gridData = this.dbManagementState.gridData;
      const details = this.dbManagementState.tableDetails;
      if (!gridData || !gridData.rows || !details) return;

      const rows = gridData.rows;
      const primaryKeys = gridData.primaryKeys || details.primaryKeys || [];
      const page = gridData.pagination?.page || this.dbManagementState.page || 1;
      const tableName = details.tableName;

      const visibleRowKeys = [];
      const visibleRowMetas = [];
      for (let i = 0; i < rows.length; i++) {
        const key = this._getCanonicalRowKey(tableName, primaryKeys, rows[i], i, page);
        const meta = this._getRowIdentityMeta(tableName, primaryKeys, rows[i], i, page);
        visibleRowKeys.push(key);
        visibleRowMetas.push(meta);
      }

      const allVisibleSelected = visibleRowKeys.length > 0 && visibleRowKeys.every(k => this.dbManagementState.selectedRowKeys.has(k));

      if (allVisibleSelected) {
        // Deselect visible rows on current page only
        for (const key of visibleRowKeys) {
          this.dbManagementState.selectedRowKeys.delete(key);
          this.dbManagementState.selectedRowsMeta.delete(key);
        }
      } else {
        // Select visible rows up to selection limit
        let limitReached = false;
        for (let i = 0; i < visibleRowKeys.length; i++) {
          const key = visibleRowKeys[i];
          if (!this.dbManagementState.selectedRowKeys.has(key)) {
            if (this.dbManagementState.selectedRowKeys.size >= this.dbManagementState.selectionLimit) {
              limitReached = true;
              break;
            }
            this.dbManagementState.selectedRowKeys.add(key);
            this.dbManagementState.selectedRowsMeta.set(key, visibleRowMetas[i]);
          }
        }
        if (limitReached) {
          this.toast(`Selection limit reached (${this.dbManagementState.selectionLimit} rows). Some rows could not be selected.`, 'warning');
        }
      }

      this._updateGridSelectionUI();
    }

    _clearDbSelection() {
      this.dbManagementState.selectedRowKeys.clear();
      this.dbManagementState.selectedRowsMeta.clear();
      this._updateGridSelectionUI();
    }

    _updateGridSelectionUI() {
      const container = document.getElementById('dbTabContentArea');
      if (!container) return;

      const gridData = this.dbManagementState.gridData;
      const details = this.dbManagementState.tableDetails;
      if (!gridData || !gridData.rows || !details) return;

      const rows = gridData.rows;
      const primaryKeys = gridData.primaryKeys || details.primaryKeys || [];
      const page = gridData.pagination?.page || this.dbManagementState.page || 1;
      const tableName = details.tableName;

      let visibleSelectedCount = 0;
      const visibleRowKeys = [];

      for (let i = 0; i < rows.length; i++) {
        const key = this._getCanonicalRowKey(tableName, primaryKeys, rows[i], i, page);
        visibleRowKeys.push(key);
        const isSelected = this.dbManagementState.selectedRowKeys.has(key);
        if (isSelected) visibleSelectedCount++;

        const escapedKey = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
        const rowCheckbox = document.querySelector(`.db-row-checkbox[data-canonical-key="${escapedKey}"]`);
        if (rowCheckbox) {
          rowCheckbox.checked = isSelected;
          const tr = rowCheckbox.closest('tr');
          if (tr) {
            if (isSelected) tr.classList.add('selected');
            else tr.classList.remove('selected');
          }
        }
      }

      // Update Header Checkbox with tri-state indeterminate support
      const headerCheckbox = document.getElementById('dbGridHeaderSelectAll');
      if (headerCheckbox) {
        if (visibleRowKeys.length === 0) {
          headerCheckbox.checked = false;
          headerCheckbox.indeterminate = false;
        } else if (visibleSelectedCount === visibleRowKeys.length) {
          headerCheckbox.checked = true;
          headerCheckbox.indeterminate = false;
        } else if (visibleSelectedCount > 0) {
          headerCheckbox.checked = false;
          headerCheckbox.indeterminate = true;
        } else {
          headerCheckbox.checked = false;
          headerCheckbox.indeterminate = false;
        }
      }

      // Update Toolbar Selection Summary Badge
      const selectedCount = this.dbManagementState.selectedRowKeys.size;
      const selectionWrap = document.getElementById('dbGridSelectionToolbarWrap');
      if (selectionWrap) {
        if (selectedCount > 0) {
          const scopeLabel = selectedCount === visibleSelectedCount
            ? '(on this page)'
            : `(${visibleSelectedCount} on this page)`;
          const isDeletable = this.dbManagementState.tableDetails?.deleteCapability?.isDeletable;
          selectionWrap.innerHTML = `
            <div class="admin-db-selection-badge">
              <span class="admin-db-selection-count">
                ${selectedCount} ${selectedCount === 1 ? 'row' : 'rows'} selected
              </span>
              <span class="admin-db-selection-scope">
                ${scopeLabel}
              </span>
              ${isDeletable ? `
                <button
                  class="admin-btn admin-btn-danger admin-btn-xs"
                  style="padding:0.125rem 0.5rem; font-size:0.6875rem;"
                  onclick="AdminShell._confirmBulkDelete('${this._escape(this.dbManagementState.tableDetails.tableName)}')"
                  title="Delete all selected records"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;margin-right:2px;display:inline-block;vertical-align:middle;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  Delete Selected (${selectedCount})
                </button>
              ` : ''}
              <button
                class="admin-btn admin-btn-secondary admin-btn-xs"
                style="padding:0.125rem 0.375rem; font-size:0.6875rem;"
                onclick="AdminShell._clearDbSelection()"
                title="Clear all selected rows"
              >
                Clear Selection
              </button>
            </div>
          `;
        } else {
          selectionWrap.innerHTML = '';
        }
      }
    }

    getSelectedRowIdentities() {
      const results = [];
      for (const [key, meta] of this.dbManagementState.selectedRowsMeta.entries()) {
        results.push({
          canonicalKey: key,
          table: meta.table,
          primaryKey: meta.primaryKey || null,
          noPrimaryKey: !!meta.noPrimaryKey
        });
      }
      return results;
    }

    _renderDbGridContent(container) {
      const details = this.dbManagementState.tableDetails;
      if (!container || !details) return;

      const gridData = this.dbManagementState.gridData;
      const isLoading = this.dbManagementState.isLoadingGrid;
      const searchQuery = this.dbManagementState.searchQuery || '';
      const filters = this.dbManagementState.filters || [];
      const sortBy = this.dbManagementState.sortBy;
      const sortDirection = this.dbManagementState.sortDirection;

      if (isLoading && !gridData) {
        container.innerHTML = `
          <div class="admin-loading-state" style="padding:4rem 2rem; text-align:center; color:var(--admin-text-muted);">
            Querying database records for '${this._escape(details.tableName)}'...
          </div>
        `;
        return;
      }

      if (!gridData && !isLoading) {
        this._loadDbGridRows(details.tableName);
        return;
      }

      const rows = gridData?.rows || [];
      const columns = gridData?.columns || details.columns || [];
      const primaryKeys = gridData?.primaryKeys || details.primaryKeys || [];
      const hasRowActions = (details.updateCapability?.isUpdatable) || (details.deleteCapability?.isDeletable);
      const pagination = gridData?.pagination || {
        page: this.dbManagementState.page,
        pageSize: this.dbManagementState.pageSize,
        totalRows: 0,
        totalMode: 'ESTIMATED',
        totalPages: 1
      };

      const startRow = rows.length > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
      const endRow = rows.length > 0 ? (pagination.page - 1) * pagination.pageSize + rows.length : 0;
      const totalRowsFormatted = pagination.totalRows.toLocaleString();

      container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.75rem;">
          <!-- Data Grid Toolbar -->
          <div class="admin-db-grid-toolbar">
            <div style="display:flex; align-items:center; gap:0.5rem; flex:1; flex-wrap:wrap;">
              <div class="admin-db-grid-search-wrap">
                <span class="admin-db-grid-search-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </span>
                <input
                  type="text"
                  class="admin-db-grid-search-input"
                  id="dbGridSearchField"
                  placeholder="Global search in text columns..."
                  value="${this._escape(searchQuery)}"
                  oninput="AdminShell._onDbGridSearchInput(this.value)"
                />
                ${searchQuery ? `<button class="admin-db-grid-search-clear" onclick="AdminShell._clearDbGridSearch()" title="Clear search">✕</button>` : ''}
              </div>

              <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._openDbFilterModal()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Add Filter ${filters.length > 0 ? `(${filters.length})` : ''}
              </button>

              ${(filters.length > 0 || searchQuery) ? `
                <button class="admin-btn admin-btn-secondary admin-btn-sm" style="color:var(--admin-danger);" onclick="AdminShell._clearDbFilters()">
                  Clear Filters
                </button>
              ` : ''}

              <!-- Selection Toolbar Region -->
              <div id="dbGridSelectionToolbarWrap" style="display:inline-flex; align-items:center;"></div>
            </div>

            <div style="display:flex; align-items:center; gap:0.75rem;">
              ${details.insertCapability && details.insertCapability.isInsertable ? `
                <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._openAddRowDrawer('${this._escape(details.tableName)}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  + Add Row
                </button>
              ` : ''}
              <span style="font-size:0.75rem; color:var(--admin-text-secondary); font-family:var(--font-mono);">
                ${rows.length > 0 ? `${startRow}–${endRow} of ${totalRowsFormatted}` : '0 rows'} (${pagination.totalMode.toLowerCase()})
              </span>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._loadDbGridRows('${this._escape(details.tableName)}')" title="Refresh Table Data">
                ${ICONS['rotate-ccw'] || ''}
              </button>
            </div>
          </div>

          <!-- Active Filter Chips Bar -->
          ${filters.length > 0 ? `
            <div class="admin-db-grid-filters-row">
              <span style="font-size:0.6875rem; color:var(--admin-text-muted); font-weight:600; text-transform:uppercase;">Active Filters (${filters.length}):</span>
              ${filters.map((f, idx) => {
                let text = '';
                const op = f.operator;
                if (op === 'between') {
                  text = `between "${this._escape(String(f.value))}" and "${this._escape(String(f.value2 ?? ''))}"`;
                } else if (op === 'isNull' || op === 'is_null') {
                  text = 'is NULL';
                } else if (op === 'isNotNull' || op === 'is_not_null') {
                  text = 'is NOT NULL';
                } else if (op === 'isEmpty' || op === 'is_empty') {
                  text = 'is empty';
                } else if (op === 'isNotEmpty' || op === 'is_not_empty') {
                  text = 'is not empty';
                } else if (op === 'isTrue' || op === 'is_true') {
                  text = 'is TRUE';
                } else if (op === 'isFalse' || op === 'is_false') {
                  text = 'is FALSE';
                } else {
                  text = `${this._escape(op)} "${this._escape(String(f.value ?? ''))}"`;
                }
                return `
                  <span class="admin-db-active-filter-chip">
                    <strong>${this._escape(f.column)}</strong> ${text}
                    <button class="admin-db-active-filter-remove" onclick="AdminShell._removeDbFilter(${idx})" title="Remove filter">✕</button>
                  </span>
                `;
              }).join('')}
              <button class="admin-btn admin-btn-secondary admin-btn-xs" style="margin-left:auto; color:var(--admin-danger); font-size:0.6875rem;" onclick="AdminShell._clearDbFilters()">
                Clear All
              </button>
            </div>
          ` : ''}

          <!-- Scrollable Sticky-Header Data Table -->
          <div class="admin-db-grid-scroll-container">
            <table class="admin-db-grid-table">
              <thead>
                <tr>
                  <!-- Selection Header Checkbox -->
                  <th class="admin-db-grid-th" style="width: 44px; text-align: center; cursor: default;">
                    <label class="admin-db-checkbox-label" title="Select all visible rows on this page">
                      <input
                        type="checkbox"
                        id="dbGridHeaderSelectAll"
                        class="admin-db-checkbox"
                        aria-label="Select all rows currently visible on this page"
                        onchange="AdminShell._toggleSelectAllVisible()"
                      />
                    </label>
                  </th>
                  <th class="admin-db-grid-th" style="width: 48px; text-align: center; cursor: default;">#</th>
                  ${hasRowActions ? `
                    <th class="admin-db-grid-th" style="width: ${(details.updateCapability?.isUpdatable && details.deleteCapability?.isDeletable) ? '128px' : '72px'}; text-align: center; cursor: default;">Actions</th>
                  ` : ''}
                  ${columns.map(col => {
                    const isSorted = sortBy === col.name;
                    const sortIcon = isSorted
                      ? (sortDirection === 'desc' ? '▼' : '▲')
                      : '⇅';
                    const ariaSort = isSorted
                      ? (sortDirection === 'desc' ? 'descending' : 'ascending')
                      : 'none';
                    return `
                      <th
                        class="admin-db-grid-th ${isSorted ? 'sorted' : ''}"
                        onclick="AdminShell._toggleDbGridSort('${this._escape(col.name)}')"
                        aria-sort="${ariaSort}"
                        title="Sort by ${this._escape(col.name)}"
                      >
                        <div class="admin-db-grid-th-content">
                          <div class="admin-db-grid-th-title">
                            <span>${this._escape(col.name)}</span>
                            ${col.isPrimaryKey ? '<span class="admin-db-pk-indicator">PK</span>' : ''}
                            <span class="admin-db-type-chip">${this._escape(col.dataType)}</span>
                          </div>
                          <span class="admin-db-sort-icon">${sortIcon}</span>
                        </div>
                      </th>
                    `;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, rIdx) => {
                  const canonicalKey = this._getCanonicalRowKey(details.tableName, primaryKeys, row, rIdx, pagination.page);
                  const isSelected = this.dbManagementState.selectedRowKeys.has(canonicalKey);
                  const isSensitivePk = primaryKeys.length === 1 && /password|token|secret|hash|private_key|auth_key|credential|otp/i.test(primaryKeys[0]);
                  const accessibleLabel = (primaryKeys.length === 1 && !isSensitivePk && row[primaryKeys[0]] !== undefined)
                    ? `Select row with ${primaryKeys[0]} ${row[primaryKeys[0]]}`
                    : `Select database row #${startRow + rIdx}`;

                  return `
                    <tr class="admin-db-grid-tr ${isSelected ? 'selected' : ''}">
                      <!-- Row Checkbox Cell -->
                      <td class="admin-db-grid-td" style="width: 44px; text-align: center;">
                        <label class="admin-db-checkbox-label" title="Select row">
                          <input
                            type="checkbox"
                            class="admin-db-checkbox db-row-checkbox"
                            data-canonical-key="${this._escape(canonicalKey)}"
                            aria-label="${this._escape(accessibleLabel)}"
                            ${isSelected ? 'checked' : ''}
                            onchange="AdminShell._onRowCheckboxChange(this, '${this._escape(canonicalKey)}')"
                            onclick="event.stopPropagation()"
                          />
                        </label>
                      </td>
                      <td class="admin-db-grid-td" style="text-align: center; color: var(--admin-text-muted);">${startRow + rIdx}</td>
                      ${hasRowActions ? `
                        <td class="admin-db-grid-td" style="text-align: center;">
                          <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center;">
                            ${details.updateCapability?.isUpdatable ? `
                              <button
                                class="admin-btn admin-btn-secondary admin-btn-xs"
                                onclick="AdminShell._openEditRowDrawer('${this._escape(details.tableName)}', ${rIdx})"
                                title="Edit this record"
                              >
                                Edit
                              </button>
                            ` : ''}
                            ${details.deleteCapability?.isDeletable ? `
                              <button
                                class="admin-btn admin-btn-danger admin-btn-xs"
                                onclick="AdminShell._confirmDeleteRow('${this._escape(details.tableName)}', ${rIdx})"
                                title="Delete this record"
                              >
                                Delete
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      ` : ''}
                      ${columns.map(col => {
                        const val = row[col.name];
                        const rendered = this._formatDataGridCell(col, val);
                        return `<td class="admin-db-grid-td">${rendered}</td>`;
                      }).join('')}
                    </tr>
                  `;
                }).join('')}
                ${rows.length === 0 ? `
                  <tr>
                    <td colspan="${columns.length + (hasRowActions ? 3 : 2)}" style="text-align: center; padding: 4rem 2rem;">
                      <div class="admin-db-empty-state">
                        <div class="admin-db-empty-state-icon">${ICONS.database || ''}</div>
                        <h4 style="margin:0; font-size:0.9375rem; color:var(--admin-text-primary);">
                          ${(searchQuery || filters.length > 0) ? 'No Matching Records Found' : 'Table is Empty'}
                        </h4>
                        <p style="margin:0; font-size:0.8125rem; max-width:380px;">
                          ${(searchQuery || filters.length > 0)
                            ? 'No records match the applied search terms or column filters. Try adjusting or clearing your filters.'
                            : 'This database table currently contains zero recorded rows.'}
                        </p>
                        ${(searchQuery || filters.length > 0) ? `
                          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._clearDbFilters()">
                            Clear Search & Filters
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>

          <!-- Server-Side Pagination Bar -->
          <div class="admin-db-grid-footer">
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <span>Showing ${rows.length > 0 ? `${startRow}–${endRow}` : '0'} of ${totalRowsFormatted} rows</span>
              <label style="display:flex; align-items:center; gap:0.375rem; margin-left:0.5rem;">
                <span>Page size:</span>
                <select class="admin-db-page-size-select" onchange="AdminShell._setDbGridPageSize(this.value)">
                  <option value="10" ${pagination.pageSize === 10 ? 'selected' : ''}>10 / page</option>
                  <option value="25" ${pagination.pageSize === 25 ? 'selected' : ''}>25 / page</option>
                  <option value="50" ${pagination.pageSize === 50 ? 'selected' : ''}>50 / page</option>
                  <option value="100" ${pagination.pageSize === 100 ? 'selected' : ''}>100 / page</option>
                </select>
              </label>
            </div>

            <div class="admin-db-pagination-controls">
              <button
                class="admin-btn admin-btn-secondary admin-btn-xs"
                ${pagination.page <= 1 ? 'disabled' : ''}
                onclick="AdminShell._setDbGridPage(1)"
                title="First Page"
              >
                « First
              </button>
              <button
                class="admin-btn admin-btn-secondary admin-btn-xs"
                ${pagination.page <= 1 ? 'disabled' : ''}
                onclick="AdminShell._setDbGridPage(${pagination.page - 1})"
                title="Previous Page"
              >
                ‹ Prev
              </button>
              <span style="font-family:var(--font-mono); font-size:0.75rem; padding:0 0.5rem;">
                Page <strong>${pagination.page}</strong> of <strong>${pagination.totalPages}</strong>
              </span>
              <button
                class="admin-btn admin-btn-secondary admin-btn-xs"
                ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
                onclick="AdminShell._setDbGridPage(${pagination.page + 1})"
                title="Next Page"
              >
                Next ›
              </button>
              <button
                class="admin-btn admin-btn-secondary admin-btn-xs"
                ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
                onclick="AdminShell._setDbGridPage(${pagination.totalPages})"
                title="Last Page"
              >
                Last »
              </button>
            </div>
          </div>
        </div>
      `;

      // Reconcile and apply selection state immediately
      setTimeout(() => this._updateGridSelectionUI(), 0);
    }

    _formatDataGridCell(col, val) {
      if (val === null || val === undefined) {
        return `<span class="admin-db-null-badge">NULL</span>`;
      }
      if (val === '[REDACTED]') {
        return `<span class="admin-badge admin-badge-danger" style="font-size:0.625rem;">[REDACTED]</span>`;
      }
      if (typeof val === 'string' && val.startsWith('[BINARY') && val.endsWith('bytes]')) {
        return `<span class="admin-badge admin-badge-neutral" style="font-size:0.625rem;">${this._escape(val)}</span>`;
      }
      if (typeof val === 'boolean') {
        return val
          ? `<span class="admin-badge admin-badge-success" style="font-size:0.625rem;">TRUE</span>`
          : `<span class="admin-badge admin-badge-neutral" style="font-size:0.625rem;">FALSE</span>`;
      }
      if (typeof val === 'object') {
        const jsonStr = JSON.stringify(val);
        const previewStr = jsonStr.length > 35 ? jsonStr.substring(0, 32) + '...' : jsonStr;
        return `
          <span
            class="admin-db-json-cell"
            onclick="AdminShell._openCellInspectModal('${this._escape(col.name)}', this.dataset.rawjson, 'JSON')"
            data-rawjson="${this._escape(jsonStr)}"
            title="Click to inspect JSON"
          >
            <code>${this._escape(previewStr)}</code>
          </span>
        `;
      }

      const strVal = String(val);
      const isDate = col.dataType.includes('date') || col.dataType.includes('time');

      if (isDate) {
        return `<span class="admin-db-date-cell">${this._escape(strVal)}</span>`;
      }

      if (strVal.length > 50) {
        return `
          <span
            style="cursor:pointer; text-decoration:underline dotted;"
            onclick="AdminShell._openCellInspectModal('${this._escape(col.name)}', this.dataset.rawtext, 'TEXT')"
            data-rawtext="${this._escape(strVal)}"
            title="Click to inspect full text"
          >
            ${this._escape(strVal.substring(0, 47))}...
          </span>
        `;
      }

      return this._escape(strVal);
    }

    async _loadDbGridRows(tableName, resetPage = false) {
      if (resetPage) {
        this.dbManagementState.page = 1;
      }

      const container = document.getElementById('dbTabContentArea');
      const reqId = ++this.dbManagementState.requestId;
      this.dbManagementState.isLoadingGrid = true;

      try {
        const params = {
          page: this.dbManagementState.page,
          pageSize: this.dbManagementState.pageSize,
          sortBy: this.dbManagementState.sortBy || undefined,
          sortDirection: this.dbManagementState.sortDirection,
          search: this.dbManagementState.searchQuery || undefined,
          filters: this.dbManagementState.filters && this.dbManagementState.filters.length > 0
            ? this.dbManagementState.filters
            : undefined
        };

        const res = await window.AdminApi.getTableRows(tableName, params);

        // Discard out-of-order stale response
        if (reqId !== this.dbManagementState.requestId) {
          return;
        }

        if (res && res.success && res.data) {
          this.dbManagementState.gridData = res.data;
          if (this.dbManagementState.activeTab === 'grid' && container) {
            this._renderDbGridContent(container);
          }
        }
      } catch (err) {
        if (reqId !== this.dbManagementState.requestId) return;
        console.error('Failed to query data grid rows:', err);
        if (container && this.dbManagementState.activeTab === 'grid') {
          container.innerHTML = `
            <div class="admin-error-banner" style="margin:1.5rem; padding:1.25rem;">
              <strong>Query Failed for '${this._escape(tableName)}'.</strong>
              <p style="margin:0.5rem 0 0 0; font-size:0.8125rem;">${this._escape(err.message || 'Error executing database query.')}</p>
              <button class="admin-btn admin-btn-secondary admin-btn-sm" style="margin-top:0.75rem;" onclick="AdminShell._loadDbGridRows('${this._escape(tableName)}')">Retry</button>
            </div>
          `;
        }
      } finally {
        if (reqId === this.dbManagementState.requestId) {
          this.dbManagementState.isLoadingGrid = false;
        }
      }
    }

    _onDbGridSearchInput(val) {
      if (this.dbManagementState.searchDebounceTimer) {
        clearTimeout(this.dbManagementState.searchDebounceTimer);
      }
      this.dbManagementState.searchDebounceTimer = setTimeout(() => {
        this.dbManagementState.searchQuery = (val || '').trim();
        this.dbManagementState.page = 1;
        this._checkNoPkReset();
        if (this.dbManagementState.selectedTable) {
          this._loadDbGridRows(this.dbManagementState.selectedTable);
        }
      }, 300);
    }

    _clearDbGridSearch() {
      const searchField = document.getElementById('dbGridSearchField');
      if (searchField) searchField.value = '';
      this.dbManagementState.searchQuery = '';
      this.dbManagementState.page = 1;
      this._checkNoPkReset();
      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    _toggleDbGridSort(columnName) {
      if (this.dbManagementState.sortBy === columnName) {
        if (this.dbManagementState.sortDirection === 'asc') {
          this.dbManagementState.sortDirection = 'desc';
        } else {
          this.dbManagementState.sortBy = null;
          this.dbManagementState.sortDirection = 'asc';
        }
      } else {
        this.dbManagementState.sortBy = columnName;
        this.dbManagementState.sortDirection = 'asc';
      }

      this._checkNoPkReset();

      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    _setDbGridPage(page) {
      const maxPage = this.dbManagementState.gridData?.pagination?.totalPages || 1;
      const boundedPage = Math.min(Math.max(1, page), maxPage);
      if (boundedPage === this.dbManagementState.page) return;

      this.dbManagementState.page = boundedPage;
      this._checkNoPkReset();

      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    _setDbGridPageSize(pageSize) {
      const size = Number(pageSize) || 25;
      if (size === this.dbManagementState.pageSize) return;

      this.dbManagementState.pageSize = size;
      this.dbManagementState.page = 1;
      this._checkNoPkReset();

      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    _openDbFilterModal() {
      const details = this.dbManagementState.tableDetails;
      if (!details || !details.columns) return;

      let modalEl = document.getElementById('adminDbFilterModal');
      if (modalEl) modalEl.remove();

      const columns = details.columns.filter(c => {
        // Exclude sensitive columns from filtering
        return !/password|token|secret|hash|private_key|auth_key|credential|otp/i.test(c.name);
      });

      const modalHtml = `
        <div class="admin-db-filter-modal-backdrop" id="adminDbFilterModal">
          <div class="admin-db-filter-modal" style="max-width: 480px;">
            <div class="admin-db-filter-modal-header">
              <span>Add Column Filter</span>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._closeDbFilterModal()">✕</button>
            </div>
            <div class="admin-db-filter-modal-body" style="display:flex; flex-direction:column; gap:1rem;">
              <div>
                <label style="display:block; font-size:0.75rem; font-weight:600; margin-bottom:0.25rem;">Column</label>
                <select id="dbFilterColumnSelect" class="admin-db-page-size-select" style="width:100%;" onchange="AdminShell._updateDbFilterOperators()">
                  ${columns.map(c => `<option value="${this._escape(c.name)}" data-type="${this._escape(c.dataType)}">${this._escape(c.name)} (${this._escape(c.dataType)})</option>`).join('')}
                </select>
              </div>

              <div>
                <label style="display:block; font-size:0.75rem; font-weight:600; margin-bottom:0.25rem;">Operator</label>
                <select id="dbFilterOperatorSelect" class="admin-db-page-size-select" style="width:100%;">
                  <!-- Populated dynamically based on column type -->
                </select>
              </div>

              <div id="dbFilterValueWrap">
                <label id="dbFilterValueLabel" style="display:block; font-size:0.75rem; font-weight:600; margin-bottom:0.25rem;">Value</label>
                <input type="text" id="dbFilterValueInput" class="admin-db-search-input" style="width:100%;" placeholder="Filter value..." />
              </div>

              <div id="dbFilterValue2Wrap" style="display:none;">
                <label style="display:block; font-size:0.75rem; font-weight:600; margin-bottom:0.25rem;">End Value (To)</label>
                <input type="text" id="dbFilterValue2Input" class="admin-db-search-input" style="width:100%;" placeholder="End range value..." />
              </div>
            </div>
            <div class="admin-db-filter-modal-footer">
              <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._closeDbFilterModal()">Cancel</button>
              <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._applyDbFilterFromModal()">Apply Filter</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);
      this._updateDbFilterOperators();
    }

    _updateDbFilterOperators() {
      const colSelect = document.getElementById('dbFilterColumnSelect');
      const opSelect = document.getElementById('dbFilterOperatorSelect');
      const valWrap = document.getElementById('dbFilterValueWrap');
      const val2Wrap = document.getElementById('dbFilterValue2Wrap');
      const valLabel = document.getElementById('dbFilterValueLabel');
      if (!colSelect || !opSelect) return;

      const opt = colSelect.options[colSelect.selectedIndex];
      const dataType = (opt?.getAttribute('data-type') || '').toLowerCase();

      let allowedOps = [];
      const isBool = dataType === 'tinyint(1)' || dataType === 'boolean' || dataType === 'bool';
      const isNum = !isBool && (dataType.includes('int') || dataType.includes('decimal') || dataType.includes('float') || dataType.includes('double') || dataType.includes('numeric'));
      const isDate = dataType.includes('date') || dataType.includes('time') || dataType.includes('year');

      if (isBool) {
        allowedOps = [
          { val: 'is_true', label: 'is TRUE' },
          { val: 'is_false', label: 'is FALSE' },
          { val: 'isNull', label: 'is NULL' },
          { val: 'isNotNull', label: 'is NOT NULL' }
        ];
      } else if (isNum) {
        allowedOps = [
          { val: 'equals', label: 'equals (=)' },
          { val: 'not_equals', label: 'not equals (!=)' },
          { val: 'greaterThan', label: 'greater than (>)' },
          { val: 'greaterThanOrEqual', label: 'greater than or equal (>=)' },
          { val: 'lessThan', label: 'less than (<)' },
          { val: 'lessThanOrEqual', label: 'less than or equal (<=)' },
          { val: 'between', label: 'between (range)' },
          { val: 'isNull', label: 'is NULL' },
          { val: 'isNotNull', label: 'is NOT NULL' }
        ];
      } else if (isDate) {
        allowedOps = [
          { val: 'equals', label: 'equals (=)' },
          { val: 'before', label: 'before (<)' },
          { val: 'after', label: 'after (>)' },
          { val: 'between', label: 'between (date range)' },
          { val: 'isNull', label: 'is NULL' },
          { val: 'isNotNull', label: 'is NOT NULL' }
        ];
      } else {
        allowedOps = [
          { val: 'contains', label: 'contains' },
          { val: 'not_contains', label: 'does not contain' },
          { val: 'equals', label: 'equals (=)' },
          { val: 'not_equals', label: 'not equals (!=)' },
          { val: 'startsWith', label: 'starts with' },
          { val: 'endsWith', label: 'ends with' },
          { val: 'isEmpty', label: 'is empty (empty or NULL)' },
          { val: 'isNotEmpty', label: 'is not empty' },
          { val: 'isNull', label: 'is NULL' },
          { val: 'isNotNull', label: 'is NOT NULL' }
        ];
      }

      opSelect.innerHTML = allowedOps.map(o => `<option value="${o.val}">${o.label}</option>`).join('');

      const syncInputs = () => {
        const op = opSelect.value;
        const noValOps = ['isNull', 'isNotNull', 'isEmpty', 'isNotEmpty', 'is_true', 'is_false', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty'];
        const isNoVal = noValOps.includes(op);
        const isBetween = op === 'between';

        if (valWrap) {
          valWrap.style.display = isNoVal ? 'none' : 'block';
        }
        if (val2Wrap) {
          val2Wrap.style.display = isBetween ? 'block' : 'none';
        }
        if (valLabel) {
          valLabel.textContent = isBetween ? 'Start Value (From)' : 'Value';
        }
      };

      opSelect.onchange = syncInputs;
      syncInputs();
    }

    _closeDbFilterModal() {
      const modal = document.getElementById('adminDbFilterModal');
      if (modal) modal.remove();
    }

    _applyDbFilterFromModal() {
      const colSelect = document.getElementById('dbFilterColumnSelect');
      const opSelect = document.getElementById('dbFilterOperatorSelect');
      const valInput = document.getElementById('dbFilterValueInput');
      const val2Input = document.getElementById('dbFilterValue2Input');
      if (!colSelect || !opSelect) return;

      const column = colSelect.value;
      const operator = opSelect.value;
      const noValOps = ['isNull', 'isNotNull', 'isEmpty', 'isNotEmpty', 'is_true', 'is_false', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty'];
      const isNoVal = noValOps.includes(operator);
      const isBetween = operator === 'between';

      let value = isNoVal ? null : (valInput?.value || '').trim();
      let value2 = isBetween ? (val2Input?.value || '').trim() : undefined;

      if (!isNoVal && !value) {
        this.toast('Please specify a filter value.', 'warning');
        return;
      }

      if (isBetween && !value2) {
        this.toast('Please specify both start and end values for between range.', 'warning');
        return;
      }

      if (this.dbManagementState.filters.length >= 10) {
        this.toast('Maximum of 10 active filters allowed.', 'warning');
        return;
      }

      const newFilter = { column, operator, value };
      if (isBetween) {
        newFilter.value2 = value2;
      }

      this.dbManagementState.filters.push(newFilter);
      this._closeDbFilterModal();
      this.dbManagementState.page = 1;
      this._checkNoPkReset();

      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }

    _removeDbFilter(index) {
      if (index >= 0 && index < this.dbManagementState.filters.length) {
        this.dbManagementState.filters.splice(index, 1);
        this.dbManagementState.page = 1;
        this._checkNoPkReset();
        if (this.dbManagementState.selectedTable) {
          this._loadDbGridRows(this.dbManagementState.selectedTable);
        }
      }
    }

    _clearDbFilters() {
      this.dbManagementState.filters = [];
      this.dbManagementState.searchQuery = '';
      const searchField = document.getElementById('dbGridSearchField');
      if (searchField) searchField.value = '';
      this.dbManagementState.page = 1;
      this._checkNoPkReset();

      if (this.dbManagementState.selectedTable) {
        this._loadDbGridRows(this.dbManagementState.selectedTable);
      }
    }


    _openCellInspectModal(columnName, rawValue, type) {
      let modalEl = document.getElementById('adminDbCellInspectModal');
      if (modalEl) modalEl.remove();

      let displayValue = rawValue || '';
      if (type === 'JSON') {
        try {
          const parsed = JSON.parse(rawValue);
          displayValue = JSON.stringify(parsed, null, 2);
        } catch (_) {}
      }

      const modalHtml = `
        <div class="admin-db-filter-modal-backdrop" id="adminDbCellInspectModal">
          <div class="admin-db-filter-modal" style="max-width: 600px;">
            <div class="admin-db-filter-modal-header">
              <span>Inspect Cell: <code>${this._escape(columnName)}</code> (${type})</span>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._closeCellInspectModal()">✕</button>
            </div>
            <div class="admin-db-filter-modal-body">
              <pre style="background:var(--admin-bg-base); padding:1rem; border:1px solid var(--admin-border); border-radius:var(--radius-xs); font-family:var(--font-mono); font-size:0.75rem; max-height:360px; overflow:auto; white-space:pre-wrap; word-break:break-all; margin:0;">${this._escape(displayValue)}</pre>
            </div>
            <div class="admin-db-filter-modal-footer">
              <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._copyText(this.dataset.raw)" data-raw="${this._escape(displayValue)}">
                ${ICONS.copy || ''} Copy Value
              </button>
              <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._closeCellInspectModal()">Close</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    _closeCellInspectModal() {
      const modal = document.getElementById('adminDbCellInspectModal');
      if (modal) modal.remove();
    }

    _openInSqlRunner(tableName) {
      if (this.sqlState) {
        this.sqlState.sql = `SELECT * FROM ${tableName} LIMIT 50;`;
      }
      window.location.hash = '#sql-runner';
    }

    _copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.toast(`Copied '${text}' to clipboard.`, 'success', 2000);
        });
      } else {
        this.toast(`Copied '${text}'`, 'info', 2000);
      }
    }

    toast(message, type = 'info', duration = 4000) {
      let container = document.getElementById('adminToastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'adminToastContainer';
        container.className = 'admin-toast-container';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'System notifications');
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `admin-toast toast-${type}`;
      toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
      toast.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite');
      toast.innerHTML = `<div style="flex:1;">${this._escape(message)}</div>`;

      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    }

    /* =========================================================================
       Phase 15 Batch 15.4: Add / Insert Row Drawer Handlers
       ========================================================================= */

    _openAddRowDrawer(tableName) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName) {
        this.toast('Table metadata is not loaded.', 'warning');
        return;
      }

      if (!details.insertCapability || !details.insertCapability.isInsertable) {
        this.toast(details.insertCapability?.reason || 'Direct insertion is not permitted on this table.', 'warning');
        return;
      }

      this.addRowState = {
        tableName,
        isDirty: false,
        isSubmitting: false,
        nullFields: new Set()
      };

      const existingBackdrop = document.getElementById('adminDbAddRowDrawerBackdrop');
      if (existingBackdrop) existingBackdrop.remove();

      const columns = details.columns || [];

      const fieldsHtml = columns.map(col => {
        const isInsertable = col.isInsertable !== false && !col.isAutoIncrement && !col.isGenerated && !col.isSensitive;

        if (!isInsertable) {
          let reasonTag = 'Read-Only';
          if (col.isAutoIncrement) reasonTag = 'Auto-Increment (Database Generated)';
          else if (col.isGenerated) reasonTag = 'Generated Column (Computed by DB)';
          else if (col.isSensitive) reasonTag = 'Sensitive Column (Protected)';

          return `
            <div class="admin-db-form-group">
              <div class="admin-db-form-label-row">
                <span class="admin-db-form-label">
                  ${this._escape(col.name)}
                  <span class="admin-db-type-chip">${this._escape(col.dataType)}</span>
                </span>
              </div>
              <div class="admin-db-read-only-field">${this._escape(reasonTag)}</div>
            </div>
          `;
        }

        const isEnum = col.enumValues && Array.isArray(col.enumValues) && col.enumValues.length > 0;
        const isBool = col.dataType === 'boolean' || col.dataType === 'tinyint(1)';
        const isJson = col.dataType === 'json';
        const isDate = col.dataType.includes('date') || col.dataType.includes('time');
        const isNum = col.dataType.includes('int') || col.dataType.includes('decimal') || col.dataType.includes('float') || col.dataType.includes('double') || col.dataType.includes('numeric');
        const isText = col.dataType.includes('text');

        let inputElementHtml = '';
        if (isEnum) {
          inputElementHtml = `
            <select id="addRowInput_${this._escape(col.name)}" class="admin-db-input" onchange="AdminShell._markAddRowDirty()">
              <option value="">-- Select ${this._escape(col.name)} --</option>
              ${col.enumValues.map(ev => `<option value="${this._escape(ev)}">${this._escape(ev)}</option>`).join('')}
            </select>
          `;
        } else if (isBool) {
          inputElementHtml = `
            <select id="addRowInput_${this._escape(col.name)}" class="admin-db-input" onchange="AdminShell._markAddRowDirty()">
              <option value="">-- Select Boolean --</option>
              <option value="true">TRUE</option>
              <option value="false">FALSE</option>
            </select>
          `;
        } else if (isJson) {
          inputElementHtml = `
            <textarea id="addRowInput_${this._escape(col.name)}" class="admin-db-textarea" placeholder="{}" oninput="AdminShell._markAddRowDirty()"></textarea>
          `;
        } else if (isDate) {
          inputElementHtml = `
            <input type="text" id="addRowInput_${this._escape(col.name)}" class="admin-db-input" placeholder="YYYY-MM-DD HH:MM:SS or ISO 8601" oninput="AdminShell._markAddRowDirty()" />
          `;
        } else if (isNum) {
          inputElementHtml = `
            <input type="text" id="addRowInput_${this._escape(col.name)}" class="admin-db-input" placeholder="e.g. 123" oninput="AdminShell._markAddRowDirty()" />
          `;
        } else if (isText) {
          inputElementHtml = `
            <textarea id="addRowInput_${this._escape(col.name)}" class="admin-db-textarea" placeholder="Enter text..." oninput="AdminShell._markAddRowDirty()"></textarea>
          `;
        } else {
          inputElementHtml = `
            <input type="text" id="addRowInput_${this._escape(col.name)}" class="admin-db-input" placeholder="Enter value..." ${col.characterMaximumLength ? `maxlength="${col.characterMaximumLength}"` : ''} oninput="AdminShell._markAddRowDirty()" />
          `;
        }

        return `
          <div class="admin-db-form-group">
            <div class="admin-db-form-label-row">
              <label for="addRowInput_${this._escape(col.name)}" class="admin-db-form-label">
                <span>${this._escape(col.name)}</span>
                ${col.isRequired ? '<span class="admin-db-required-asterisk" title="Required field">*</span>' : ''}
                ${col.isPrimaryKey ? '<span class="admin-db-pk-indicator">PK</span>' : ''}
                ${col.foreignKey ? `<span class="admin-db-fk-badge" title="References ${this._escape(col.foreignKey.referencedTable)}.${this._escape(col.foreignKey.referencedColumn)}">FK → ${this._escape(col.foreignKey.referencedTable)}</span>` : ''}
                <span class="admin-db-type-chip">${this._escape(col.dataType)}</span>
              </label>
              ${col.isNullable ? `
                <label class="admin-db-null-toggle">
                  <input type="checkbox" onchange="AdminShell._toggleNullField('${this._escape(col.name)}', this.checked)" />
                  <span>Set NULL</span>
                </label>
              ` : ''}
            </div>
            ${inputElementHtml}
            <div style="font-size:0.6875rem; color:var(--admin-text-muted); display:flex; justify-content:space-between;">
              <span>${col.columnDefault !== null && col.columnDefault !== undefined ? `Default: <code>${this._escape(col.columnDefault)}</code>` : (col.isRequired ? 'Required' : 'Optional')}</span>
              ${col.characterMaximumLength ? `<span>Max length: ${col.characterMaximumLength}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      const drawerHtml = `
        <div class="admin-db-drawer-backdrop" id="adminDbAddRowDrawerBackdrop" onclick="AdminShell._onAddRowDrawerBackdropClick(event)">
          <div class="admin-db-drawer" id="adminDbAddRowDrawer">
            <div class="admin-db-drawer-header">
              <div>
                <div class="admin-db-drawer-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--admin-primary);"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Insert Row: <code>${this._escape(tableName)}</code></span>
                </div>
                <div style="font-size:0.75rem; color:var(--admin-text-secondary); margin-top:0.25rem;">
                  Create a single verified record. Authoritative server-side constraints apply.
                </div>
              </div>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._closeAddRowDrawer()" title="Close Drawer">✕</button>
            </div>

            <div class="admin-db-drawer-body">
              <div id="addRowErrorBanner" style="display:none;"></div>
              <form id="addRowRecordForm" onsubmit="event.preventDefault(); AdminShell._submitAddRowForm('${this._escape(tableName)}');">
                <div style="display:flex; flex-direction:column; gap:1rem;">
                  ${fieldsHtml}
                </div>
              </form>
            </div>

            <div class="admin-db-drawer-footer">
              <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._closeAddRowDrawer()">
                Cancel
              </button>
              <button type="button" id="submitAddRowBtn" class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._submitAddRowForm('${this._escape(tableName)}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Insert Record
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', drawerHtml);
    }

    _markAddRowDirty() {
      if (this.addRowState) {
        this.addRowState.isDirty = true;
      }
    }

    _toggleNullField(colName, isNull) {
      if (!this.addRowState) return;
      if (isNull) {
        this.addRowState.nullFields.add(colName);
        const input = document.getElementById(`addRowInput_${colName}`);
        if (input) {
          input.disabled = true;
        }
      } else {
        this.addRowState.nullFields.delete(colName);
        const input = document.getElementById(`addRowInput_${colName}`);
        if (input) {
          input.disabled = false;
        }
      }
      this.addRowState.isDirty = true;
    }

    _onAddRowDrawerBackdropClick(event) {
      if (event && event.target && event.target.id === 'adminDbAddRowDrawerBackdrop') {
        this._closeAddRowDrawer();
      }
    }

    _closeAddRowDrawer(force = false) {
      if (!force && this.addRowState?.isDirty) {
        const discard = window.confirm('You have unsaved changes in this record. Are you sure you want to discard them?');
        if (!discard) return;
      }

      const backdrop = document.getElementById('adminDbAddRowDrawerBackdrop');
      if (backdrop) backdrop.remove();
      this.addRowState = null;
    }

    async _submitAddRowForm(tableName) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName || !this.addRowState) return;

      const errorBanner = document.getElementById('addRowErrorBanner');
      const submitBtn = document.getElementById('submitAddRowBtn');

      if (errorBanner) {
        errorBanner.style.display = 'none';
        errorBanner.innerHTML = '';
      }

      const columns = details.columns || [];
      const values = {};

      for (const col of columns) {
        const isInsertable = col.isInsertable !== false && !col.isAutoIncrement && !col.isGenerated && !col.isSensitive;
        if (!isInsertable) continue;

        if (this.addRowState.nullFields.has(col.name)) {
          values[col.name] = null;
          continue;
        }

        const input = document.getElementById(`addRowInput_${col.name}`);
        const rawVal = input ? input.value : '';

        if (rawVal === '') {
          if (col.isRequired) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Validation Error:</strong> Column '${this._escape(col.name)}' is required.</div>`;
            }
            if (input) input.focus();
            return;
          }
          if (col.columnDefault !== null && col.columnDefault !== undefined) {
            // Omit so database applies server default
            continue;
          }
          if (col.isNullable) {
            values[col.name] = null;
            continue;
          }
          continue;
        }

        // Parse and validate based on type
        const isBool = col.dataType === 'boolean' || col.dataType === 'tinyint(1)';
        const isJson = col.dataType === 'json';
        const isInt = col.dataType.includes('int');
        const isDec = col.dataType.includes('decimal') || col.dataType.includes('float') || col.dataType.includes('double') || col.dataType.includes('numeric');

        if (isBool) {
          values[col.name] = rawVal === 'true';
        } else if (isJson) {
          try {
            JSON.parse(rawVal);
            values[col.name] = rawVal;
          } catch (jsonErr) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>JSON Syntax Error:</strong> Invalid JSON in '${this._escape(col.name)}': ${this._escape(jsonErr.message)}</div>`;
            }
            if (input) input.focus();
            return;
          }
        } else if (isInt) {
          if (!/^-?\d+$/.test(rawVal.trim())) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Type Error:</strong> '${this._escape(col.name)}' must be an integer.</div>`;
            }
            if (input) input.focus();
            return;
          }
          values[col.name] = rawVal.trim();
        } else if (isDec) {
          if (!/^-?\d+(\.\d+)?$/.test(rawVal.trim())) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Type Error:</strong> '${this._escape(col.name)}' must be a valid decimal/number.</div>`;
            }
            if (input) input.focus();
            return;
          }
          values[col.name] = rawVal.trim();
        } else {
          values[col.name] = rawVal;
        }
      }

      this.addRowState.isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg class="admin-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;display:inline-block;animation:spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
          Inserting...
        `;
      }

      try {
        const res = await window.AdminApi.insertTableRow(tableName, values);
        if (res && res.success) {
          this.toast(`Record inserted into '${tableName}' successfully.`, 'success');
          this._closeAddRowDrawer(true);
          this._loadDbGridRows(tableName);
        } else {
          throw new Error(res?.error?.message || 'Server rejected insert request.');
        }
      } catch (err) {
        console.error('Insert row failed:', err);
        if (errorBanner) {
          errorBanner.style.display = 'block';
          errorBanner.innerHTML = `
            <div class="admin-error-banner" style="margin:0;">
              <strong>Insertion Failed:</strong> ${this._escape(err.message || 'Error executing insert operation.')}
            </div>
          `;
        }
      } finally {
        if (this.addRowState) {
          this.addRowState.isSubmitting = false;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Insert Record
          `;
        }
      }
    }

    /* =========================================================================
       Phase 15 Batch 15.5: Edit / Update Row Drawer Handlers
       ========================================================================= */

    _openEditRowDrawer(tableName, rowIndex) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName) {
        this.toast('Table metadata is not loaded.', 'warning');
        return;
      }

      if (!details.updateCapability || !details.updateCapability.isUpdatable) {
        this.toast(details.updateCapability?.reason || 'Direct record update is not permitted on this table.', 'warning');
        return;
      }

      const rows = this.dbManagementState.gridData?.rows || [];
      const originalRow = rows[rowIndex];
      if (!originalRow) {
        this.toast('Selected row was not found in the current view.', 'warning');
        return;
      }

      // Concurrency tracking value from the original row
      const concurrencyField = details.updateCapability.concurrencyField;
      const concurrencyValue = concurrencyField ? originalRow[concurrencyField] : undefined;

      this.editRowState = {
        tableName,
        rowIndex,
        originalRow,
        concurrencyValue,
        isDirty: false,
        isSubmitting: false,
        nullFields: new Set()
      };

      const existingBackdrop = document.getElementById('adminDbEditRowDrawerBackdrop');
      if (existingBackdrop) existingBackdrop.remove();

      const columns = details.columns || [];

      const fieldsHtml = columns.map(col => {
        const isEditable = col.isEditable === true && !col.isPrimaryKey && !col.isAutoIncrement && !col.isGenerated && !col.isSensitive;
        const currentVal = originalRow[col.name];

        if (!isEditable) {
          let reasonTag = 'Read-Only Column';
          if (col.isPrimaryKey) reasonTag = 'Primary Key (Immutable)';
          else if (col.isAutoIncrement) reasonTag = 'Auto-Increment (Immutable)';
          else if (col.isGenerated) reasonTag = 'Generated Column (Computed by DB)';
          else if (col.isSensitive) reasonTag = 'Sensitive Column (Protected)';

          let displayVal = currentVal;
          if (displayVal === null || displayVal === undefined) displayVal = 'NULL';
          else if (typeof displayVal === 'object') displayVal = JSON.stringify(displayVal);
          else displayVal = String(displayVal);

          return `
            <div class="admin-db-form-group">
              <div class="admin-db-form-label-row">
                <span class="admin-db-form-label">
                  ${this._escape(col.name)}
                  ${col.isPrimaryKey ? '<span class="admin-db-pk-indicator">PK</span>' : ''}
                  <span class="admin-db-type-chip">${this._escape(col.dataType)}</span>
                </span>
                <span style="font-size:0.6875rem; color:var(--admin-text-muted);">${this._escape(reasonTag)}</span>
              </div>
              <div class="admin-db-read-only-field">
                <code>${this._escape(displayVal)}</code>
              </div>
            </div>
          `;
        }

        const isEnum = col.enumValues && Array.isArray(col.enumValues) && col.enumValues.length > 0;
        const isBool = col.dataType === 'boolean' || col.dataType === 'tinyint(1)';
        const isJson = col.dataType === 'json';
        const isDate = col.dataType.includes('date') || col.dataType.includes('time');
        const isNum = col.dataType.includes('int') || col.dataType.includes('decimal') || col.dataType.includes('float') || col.dataType.includes('double') || col.dataType.includes('numeric');
        const isText = col.dataType.includes('text');

        let inputElementHtml = '';
        if (isEnum) {
          inputElementHtml = `
            <select id="editRowInput_${this._escape(col.name)}" class="admin-db-input" onchange="AdminShell._markEditRowDirty()">
              ${col.isNullable ? `<option value="">-- NULL --</option>` : ''}
              ${col.enumValues.map(ev => `<option value="${this._escape(ev)}" ${currentVal === ev ? 'selected' : ''}>${this._escape(ev)}</option>`).join('')}
            </select>
          `;
        } else if (isBool) {
          const boolValStr = currentVal === true || currentVal === 1 ? 'true' : (currentVal === false || currentVal === 0 ? 'false' : '');
          inputElementHtml = `
            <select id="editRowInput_${this._escape(col.name)}" class="admin-db-input" onchange="AdminShell._markEditRowDirty()">
              <option value="true" ${boolValStr === 'true' ? 'selected' : ''}>TRUE</option>
              <option value="false" ${boolValStr === 'false' ? 'selected' : ''}>FALSE</option>
            </select>
          `;
        } else if (isJson) {
          const jsonVal = typeof currentVal === 'object' && currentVal !== null ? JSON.stringify(currentVal, null, 2) : (currentVal || '');
          inputElementHtml = `
            <textarea id="editRowInput_${this._escape(col.name)}" class="admin-db-textarea" placeholder="{}" oninput="AdminShell._markEditRowDirty()">${this._escape(jsonVal)}</textarea>
          `;
        } else if (isDate) {
          const dateVal = currentVal ? (typeof currentVal === 'string' ? currentVal : new Date(currentVal).toISOString()) : '';
          inputElementHtml = `
            <input type="text" id="editRowInput_${this._escape(col.name)}" class="admin-db-input" value="${this._escape(dateVal)}" placeholder="YYYY-MM-DD HH:MM:SS or ISO 8601" oninput="AdminShell._markEditRowDirty()" />
          `;
        } else if (isNum) {
          const numVal = currentVal !== null && currentVal !== undefined ? String(currentVal) : '';
          inputElementHtml = `
            <input type="text" id="editRowInput_${this._escape(col.name)}" class="admin-db-input" value="${this._escape(numVal)}" placeholder="e.g. 123" oninput="AdminShell._markEditRowDirty()" />
          `;
        } else if (isText) {
          const textVal = currentVal !== null && currentVal !== undefined ? String(currentVal) : '';
          inputElementHtml = `
            <textarea id="editRowInput_${this._escape(col.name)}" class="admin-db-textarea" placeholder="Enter text..." oninput="AdminShell._markEditRowDirty()">${this._escape(textVal)}</textarea>
          `;
        } else {
          const strVal = currentVal !== null && currentVal !== undefined ? String(currentVal) : '';
          inputElementHtml = `
            <input type="text" id="editRowInput_${this._escape(col.name)}" class="admin-db-input" value="${this._escape(strVal)}" placeholder="Enter value..." ${col.characterMaximumLength ? `maxlength="${col.characterMaximumLength}"` : ''} oninput="AdminShell._markEditRowDirty()" />
          `;
        }

        const isInitiallyNull = currentVal === null || currentVal === undefined;
        if (isInitiallyNull) {
          this.editRowState.nullFields.add(col.name);
        }

        return `
          <div class="admin-db-form-group">
            <div class="admin-db-form-label-row">
              <label for="editRowInput_${this._escape(col.name)}" class="admin-db-form-label">
                <span>${this._escape(col.name)}</span>
                ${col.isRequired ? '<span class="admin-db-required-asterisk" title="Required field">*</span>' : ''}
                ${col.foreignKey ? `<span class="admin-db-fk-badge" title="References ${this._escape(col.foreignKey.referencedTable)}.${this._escape(col.foreignKey.referencedColumn)}">FK → ${this._escape(col.foreignKey.referencedTable)}</span>` : ''}
                <span class="admin-db-type-chip">${this._escape(col.dataType)}</span>
              </label>
              ${col.isNullable ? `
                <label class="admin-db-null-toggle">
                  <input type="checkbox" id="editNullCheck_${this._escape(col.name)}" ${isInitiallyNull ? 'checked' : ''} onchange="AdminShell._toggleEditNullField('${this._escape(col.name)}', this.checked)" />
                  <span>Set NULL</span>
                </label>
              ` : ''}
            </div>
            ${inputElementHtml}
            <div style="font-size:0.6875rem; color:var(--admin-text-muted); display:flex; justify-content:space-between;">
              <span>${col.isRequired ? 'Required' : 'Optional'}</span>
              ${col.characterMaximumLength ? `<span>Max length: ${col.characterMaximumLength}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      const pkSummary = (details.primaryKeys || []).map(pk => `${pk}: ${originalRow[pk]}`).join(', ');

      const drawerHtml = `
        <div class="admin-db-drawer-backdrop" id="adminDbEditRowDrawerBackdrop" onclick="AdminShell._onEditRowDrawerBackdropClick(event)">
          <div class="admin-db-drawer" id="adminDbEditRowDrawer">
            <div class="admin-db-drawer-header">
              <div>
                <div class="admin-db-drawer-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--admin-primary);"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  <span>Edit Record: <code>${this._escape(tableName)}</code></span>
                </div>
                <div style="font-size:0.75rem; color:var(--admin-text-secondary); margin-top:0.25rem;">
                  Target PK: <code class="admin-code-pill">${this._escape(pkSummary || 'N/A')}</code>
                </div>
              </div>
              <button class="admin-btn admin-btn-secondary admin-btn-xs" onclick="AdminShell._closeEditRowDrawer()" title="Close Drawer">✕</button>
            </div>

            <div class="admin-db-drawer-body">
              <div id="editRowErrorBanner" style="display:none;"></div>
              <form id="editRowRecordForm" onsubmit="event.preventDefault(); AdminShell._submitEditRowForm('${this._escape(tableName)}');">
                <div style="display:flex; flex-direction:column; gap:1rem;">
                  ${fieldsHtml}
                </div>
              </form>
            </div>

            <div class="admin-db-drawer-footer">
              <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._closeEditRowDrawer()">
                Cancel
              </button>
              <button type="button" id="submitEditRowBtn" class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell._submitEditRowForm('${this._escape(tableName)}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', drawerHtml);

      // Disable inputs that are initially NULL
      if (this.editRowState?.nullFields) {
        for (const nullCol of this.editRowState.nullFields) {
          const inp = document.getElementById(`editRowInput_${nullCol}`);
          if (inp) inp.disabled = true;
        }
      }
    }

    _markEditRowDirty() {
      if (this.editRowState) {
        this.editRowState.isDirty = true;
      }
    }

    _toggleEditNullField(colName, isNull) {
      if (!this.editRowState) return;
      const input = document.getElementById(`editRowInput_${colName}`);
      if (isNull) {
        this.editRowState.nullFields.add(colName);
        if (input) input.disabled = true;
      } else {
        this.editRowState.nullFields.delete(colName);
        if (input) input.disabled = false;
      }
      this.editRowState.isDirty = true;
    }

    _onEditRowDrawerBackdropClick(event) {
      if (event && event.target && event.target.id === 'adminDbEditRowDrawerBackdrop') {
        this._closeEditRowDrawer();
      }
    }

    _closeEditRowDrawer(force = false) {
      if (!force && this.editRowState?.isDirty) {
        const discard = window.confirm('You have unsaved changes in this record. Are you sure you want to discard them?');
        if (!discard) return;
      }

      const backdrop = document.getElementById('adminDbEditRowDrawerBackdrop');
      if (backdrop) backdrop.remove();
      this.editRowState = null;
    }

    async _submitEditRowForm(tableName) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName || !this.editRowState) return;

      const errorBanner = document.getElementById('editRowErrorBanner');
      const submitBtn = document.getElementById('submitEditRowBtn');

      if (errorBanner) {
        errorBanner.style.display = 'none';
        errorBanner.innerHTML = '';
      }

      const primaryKeys = details.primaryKeys || [];
      if (primaryKeys.length === 0) {
        if (errorBanner) {
          errorBanner.style.display = 'block';
          errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;">Table has no primary key defined. Updates are disabled.</div>`;
        }
        return;
      }

      const pkPayload = {};
      for (const pk of primaryKeys) {
        const pkVal = this.editRowState.originalRow[pk];
        if (pkVal === undefined || pkVal === null) {
          if (errorBanner) {
            errorBanner.style.display = 'block';
            errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;">Missing primary key value for '${this._escape(pk)}'.</div>`;
          }
          return;
        }
        pkPayload[pk] = pkVal;
      }

      const columns = details.columns || [];
      const values = {};

      for (const col of columns) {
        const isEditable = col.isEditable === true && !col.isPrimaryKey && !col.isAutoIncrement && !col.isGenerated && !col.isSensitive;
        if (!isEditable) continue;

        if (this.editRowState.nullFields.has(col.name)) {
          values[col.name] = null;
          continue;
        }

        const input = document.getElementById(`editRowInput_${col.name}`);
        const rawVal = input ? input.value : '';

        if (rawVal === '') {
          if (col.isRequired) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Validation Error:</strong> Column '${this._escape(col.name)}' is required.</div>`;
            }
            if (input) input.focus();
            return;
          }
          if (col.isNullable) {
            values[col.name] = null;
            continue;
          }
        }

        // Parse and validate based on type
        const isBool = col.dataType === 'boolean' || col.dataType === 'tinyint(1)';
        const isJson = col.dataType === 'json';
        const isInt = col.dataType.includes('int');
        const isDec = col.dataType.includes('decimal') || col.dataType.includes('float') || col.dataType.includes('double') || col.dataType.includes('numeric');

        if (isBool) {
          values[col.name] = rawVal === 'true';
        } else if (isJson) {
          try {
            JSON.parse(rawVal);
            values[col.name] = rawVal;
          } catch (jsonErr) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>JSON Syntax Error:</strong> Invalid JSON in '${this._escape(col.name)}': ${this._escape(jsonErr.message)}</div>`;
            }
            if (input) input.focus();
            return;
          }
        } else if (isInt) {
          if (!/^-?\d+$/.test(rawVal.trim())) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Type Error:</strong> '${this._escape(col.name)}' must be an integer.</div>`;
            }
            if (input) input.focus();
            return;
          }
          values[col.name] = rawVal.trim();
        } else if (isDec) {
          if (!/^-?\d+(\.\d+)?$/.test(rawVal.trim())) {
            if (errorBanner) {
              errorBanner.style.display = 'block';
              errorBanner.innerHTML = `<div class="admin-error-banner" style="margin:0;"><strong>Type Error:</strong> '${this._escape(col.name)}' must be a valid decimal/number.</div>`;
            }
            if (input) input.focus();
            return;
          }
          values[col.name] = rawVal.trim();
        } else {
          values[col.name] = rawVal;
        }
      }

      this.editRowState.isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg class="admin-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;display:inline-block;animation:spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
          Saving...
        `;
      }

      try {
        const payload = {
          primaryKey: pkPayload,
          values,
          concurrencyValue: this.editRowState.concurrencyValue
        };

        const res = await window.AdminApi.updateTableRow(tableName, payload);
        if (res && res.success) {
          this.toast(`Record in '${tableName}' updated successfully.`, 'success');
          this._closeEditRowDrawer(true);
          this._loadDbGridRows(tableName);
        } else {
          throw new Error(res?.error?.message || 'Server rejected update request.');
        }
      } catch (err) {
        console.error('Update row failed:', err);
        if (errorBanner) {
          errorBanner.style.display = 'block';
          const isConflict = err.message && (err.message.toLowerCase().includes('concurrency') || err.message.toLowerCase().includes('conflict')) || err.status === 409;
          errorBanner.innerHTML = `
            <div class="admin-error-banner" style="margin:0;">
              <strong>${isConflict ? 'Concurrency Conflict:' : 'Update Failed:'}</strong> ${this._escape(err.message || 'Error executing update operation.')}
              ${isConflict ? '<p style="margin:0.25rem 0 0 0; font-size:0.75rem;">Another process modified this record. Please close and refresh the table to inspect current data.</p>' : ''}
            </div>
          `;
        }
      } finally {
        if (this.editRowState) {
          this.editRowState.isSubmitting = false;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Save Changes
          `;
        }
      }
    }

    /* =========================================================================
       Phase 15 Batch 15.6: Delete & Bulk Delete Handlers
       ========================================================================= */

    _confirmDeleteRow(tableName, rowIndex) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName) {
        this.toast('Table metadata is not loaded.', 'warning');
        return;
      }

      if (!details.deleteCapability || !details.deleteCapability.isDeletable) {
        this.toast(details.deleteCapability?.reason || 'Record deletion is not permitted on this table.', 'warning');
        return;
      }

      const rows = this.dbManagementState.gridData?.rows || [];
      const targetRow = rows[rowIndex];
      if (!targetRow) {
        this.toast('Target row was not found in the current view.', 'warning');
        return;
      }

      const primaryKeys = details.primaryKeys || [];
      if (primaryKeys.length === 0) {
        this.toast('Table has no primary key defined. Deletion is disabled.', 'warning');
        return;
      }

      const pkPayload = {};
      for (const pk of primaryKeys) {
        const val = targetRow[pk];
        if (val === undefined || val === null) {
          this.toast(`Missing primary key value for '${pk}'.`, 'danger');
          return;
        }
        pkPayload[pk] = val;
      }

      const pkSummary = primaryKeys.map(pk => `${pk}: ${targetRow[pk]}`).join(', ');

      this.showConfirmModal({
        title: 'Confirm Record Deletion',
        message: `Are you sure you want to permanently delete this record from table <strong>${this._escape(tableName)}</strong>?<br><br>Target Primary Key: <code class="admin-code-pill">${this._escape(pkSummary)}</code>`,
        warningText: 'This operation is permanent and cannot be undone. If other database records depend on this row, deletion will be safely rejected by foreign-key constraints.',
        confirmLabel: 'Delete Record',
        confirmType: 'danger',
        onConfirm: async () => {
          try {
            const res = await window.AdminApi.deleteTableRow(tableName, pkPayload);
            if (res && res.success) {
              this.toast(`Record in '${tableName}' deleted successfully.`, 'success');
              // Reconcile selection state
              const canonicalKey = this._getCanonicalRowKey(tableName, primaryKeys, targetRow, rowIndex, this.dbManagementState.page);
              this.dbManagementState.selectedRowKeys.delete(canonicalKey);
              this.dbManagementState.selectedRowsMeta.delete(canonicalKey);

              // If this was the only row on page > 1, navigate to previous page
              if (rows.length === 1 && this.dbManagementState.page > 1) {
                this.dbManagementState.page -= 1;
              }

              this._loadDbGridRows(tableName);
            } else {
              throw new Error(res?.error?.message || 'Server rejected delete operation.');
            }
          } catch (err) {
            console.error('Delete row failed:', err);
            this.toast(err.message || 'Failed to delete record.', 'danger', 6000);
          }
        }
      });
    }

    _confirmBulkDelete(tableName) {
      const details = this.dbManagementState.tableDetails;
      if (!details || details.tableName !== tableName) {
        this.toast('Table metadata is not loaded.', 'warning');
        return;
      }

      if (!details.deleteCapability || !details.deleteCapability.isDeletable) {
        this.toast(details.deleteCapability?.reason || 'Bulk deletion is not permitted on this table.', 'warning');
        return;
      }

      const primaryKeys = details.primaryKeys || [];
      if (primaryKeys.length === 0) {
        this.toast('Table has no primary key defined. Bulk deletion is disabled.', 'warning');
        return;
      }

      const selectedKeys = Array.from(this.dbManagementState.selectedRowKeys);
      if (selectedKeys.length === 0) {
        this.toast('Please select at least 1 record to delete.', 'warning');
        return;
      }

      const maxLimit = details.deleteCapability.maxRows || 50;
      if (selectedKeys.length > maxLimit) {
        this.toast(`Bulk delete is limited to a maximum of ${maxLimit} records per operation. You have ${selectedKeys.length} selected.`, 'warning');
        return;
      }

      // Extract structured primary key objects from canonical keys
      const rowIdentities = [];
      const parsedKeys = [];

      for (const canonicalStr of selectedKeys) {
        try {
          const parsed = JSON.parse(canonicalStr);
          if (parsed.t === tableName && parsed.k && typeof parsed.k === 'object') {
            rowIdentities.push(parsed.k);
            parsedKeys.push(canonicalStr);
          }
        } catch (_) {}
      }

      if (rowIdentities.length === 0) {
        this.toast('No valid primary-key row identities found for this table.', 'warning');
        return;
      }

      this.showConfirmModal({
        title: 'Confirm Bulk Record Deletion',
        message: `Are you sure you want to permanently delete <strong>${rowIdentities.length} selected records</strong> from table <strong>${this._escape(tableName)}</strong>?`,
        warningText: 'This operation is atomic and irreversible. If any requested record has been modified or has foreign-key dependencies, the entire bulk operation will be safely aborted with zero records deleted.',
        confirmLabel: `Delete ${rowIdentities.length} Records`,
        confirmType: 'danger',
        onConfirm: async () => {
          try {
            const res = await window.AdminApi.bulkDeleteTableRows(tableName, rowIdentities);
            if (res && res.success) {
              const deletedCount = res.data?.deletedCount || rowIdentities.length;
              this.toast(`Successfully deleted ${deletedCount} records from '${tableName}'.`, 'success');

              // Clear deleted selections
              for (const k of parsedKeys) {
                this.dbManagementState.selectedRowKeys.delete(k);
                this.dbManagementState.selectedRowsMeta.delete(k);
              }

              // Adjust page if all rows were deleted on page > 1
              const currentRows = this.dbManagementState.gridData?.rows || [];
              if (currentRows.length <= rowIdentities.length && this.dbManagementState.page > 1) {
                this.dbManagementState.page -= 1;
              }

              this._loadDbGridRows(tableName);
            } else {
              throw new Error(res?.error?.message || 'Server rejected bulk delete operation.');
            }
          } catch (err) {
            console.error('Bulk delete failed:', err);
            this.toast(err.message || 'Failed to bulk delete records.', 'danger', 6000);
          }
        }
      });
    }

    _escape(str) {
      if (!str) return '';
      const p = document.createElement('p');
      p.appendChild(document.createTextNode(String(str)));
      return p.innerHTML;
    }
  }

  window.AdminShell = new AdminShellManager();
  window.AdminShell.MODULE_REGISTRY = MODULE_REGISTRY;
})(window);
