import {
  SupportCaseStatus,
  SupportCasePriority,
  SupportCaseCategory
} from '@prisma/client';

export interface SupportOverviewMetrics {
  totalCases: number;
  openCases: number;
  inProgressCases: number;
  waitingOnCustomerCases: number;
  resolvedCases: number;
  closedCases: number;
  urgentCases: number;
  highPriorityCases: number;
  unassignedCases: number;
  casesByCategory: Record<SupportCaseCategory, number>;
  casesByPriority: Record<SupportCasePriority, number>;
  casesByStatus: Record<SupportCaseStatus, number>;
}

export interface SupportCaseSummaryItem {
  id: string;
  caseNumber: string;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  subject: string;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  assignedAdminId: string | null;
  assignedAdminName: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface SupportCaseNoteItem {
  id: string;
  caseId: string;
  adminId: string;
  adminName: string;
  note: string;
  isInternal: boolean;
  createdAt: string;
}

export interface SafeUserSupportContext {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface SafeDeviceSupportContext {
  id: string;
  deviceName: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  serverCount: number;
  createdAt: string;
}

export interface SafeServerSupportContext {
  id: string;
  deviceId: string;
  serverName: string | null;
  status: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface SafeBillingSupportContext {
  status: string | null;
  currency: string | null;
  billingCountry: string | null;
  activeSubscriptionId: string | null;
  activePlanCode: string | null;
  currentPeriodEnd: string | null;
  totalPaymentsCount: number;
  totalRefundsCount: number;
}

export interface SupportCaseDetailResult {
  id: string;
  caseNumber: string;
  userId: string;
  subject: string;
  description: string;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  assignedAdminId: string | null;
  assignedAdmin: {
    id: string;
    name: string;
    email: string;
  } | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: SupportCaseNoteItem[];
  customerContext: {
    user: SafeUserSupportContext;
    devices: SafeDeviceSupportContext[];
    servers: SafeServerSupportContext[];
    billing: SafeBillingSupportContext | null;
  };
}
