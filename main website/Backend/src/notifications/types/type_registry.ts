/**
 * RemoteNode Canonical Notification Type Registry
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationCategory } from './category.js';
import { NotificationSeverity } from './severity.js';

export enum NotificationType {
  // ACCOUNT_SECURITY
  ACCOUNT_CREATED = 'ACCOUNT_CREATED',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  SIGN_IN = 'SIGN_IN',
  SECURITY_EVENT = 'SECURITY_EVENT',

  // DEVICE_SERVER
  DEVICE_LINKED = 'DEVICE_LINKED',
  DEVICE_ONLINE = 'DEVICE_ONLINE',
  DEVICE_OFFLINE = 'DEVICE_OFFLINE',
  SERVER_CREATED = 'SERVER_CREATED',
  SERVER_STARTED = 'SERVER_STARTED',
  SERVER_STOPPED = 'SERVER_STOPPED',
  SERVER_UNAVAILABLE = 'SERVER_UNAVAILABLE',
  SERVER_RECOVERED = 'SERVER_RECOVERED',
  GATEWAY_CONNECTED = 'GATEWAY_CONNECTED',
  GATEWAY_DISCONNECTED = 'GATEWAY_DISCONNECTED',

  // FILE_OPERATIONS
  FILE_UPLOAD_COMPLETED = 'FILE_UPLOAD_COMPLETED',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_OPERATION_COMPLETED = 'FILE_OPERATION_COMPLETED',
  FILE_OPERATION_FAILED = 'FILE_OPERATION_FAILED',

  // STORAGE
  STORAGE_WARNING = 'STORAGE_WARNING',
  STORAGE_CRITICAL = 'STORAGE_CRITICAL',
  STORAGE_RECOVERED = 'STORAGE_RECOVERED',

  // SYSTEM
  SERVICE_MAINTENANCE = 'SERVICE_MAINTENANCE',
  SERVICE_OUTAGE = 'SERVICE_OUTAGE',
  SERVICE_RECOVERED = 'SERVICE_RECOVERED',
  SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT',
  TEST_NOTIFICATION = 'TEST_NOTIFICATION'
}

export interface NotificationTypeMeta {
  type: NotificationType;
  category: NotificationCategory;
  defaultSeverity: NotificationSeverity;
  isSecurityCritical: boolean;
}

export const NOTIFICATION_TYPE_CATALOG: Record<NotificationType, NotificationTypeMeta> = Object.freeze({
  // Account / Security
  [NotificationType.ACCOUNT_CREATED]: {
    type: NotificationType.ACCOUNT_CREATED,
    category: NotificationCategory.ACCOUNT_SECURITY,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.EMAIL_VERIFICATION]: {
    type: NotificationType.EMAIL_VERIFICATION,
    category: NotificationCategory.ACCOUNT_SECURITY,
    defaultSeverity: NotificationSeverity.SECURITY,
    isSecurityCritical: true
  },
  [NotificationType.SIGN_IN]: {
    type: NotificationType.SIGN_IN,
    category: NotificationCategory.ACCOUNT_SECURITY,
    defaultSeverity: NotificationSeverity.SECURITY,
    isSecurityCritical: true
  },
  [NotificationType.SECURITY_EVENT]: {
    type: NotificationType.SECURITY_EVENT,
    category: NotificationCategory.ACCOUNT_SECURITY,
    defaultSeverity: NotificationSeverity.SECURITY,
    isSecurityCritical: true
  },

  // Device / Server
  [NotificationType.DEVICE_LINKED]: {
    type: NotificationType.DEVICE_LINKED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: true
  },
  [NotificationType.DEVICE_ONLINE]: {
    type: NotificationType.DEVICE_ONLINE,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.DEVICE_OFFLINE]: {
    type: NotificationType.DEVICE_OFFLINE,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },
  [NotificationType.SERVER_CREATED]: {
    type: NotificationType.SERVER_CREATED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: false
  },
  [NotificationType.SERVER_STARTED]: {
    type: NotificationType.SERVER_STARTED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.SERVER_STOPPED]: {
    type: NotificationType.SERVER_STOPPED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },
  [NotificationType.SERVER_UNAVAILABLE]: {
    type: NotificationType.SERVER_UNAVAILABLE,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.CRITICAL,
    isSecurityCritical: false
  },
  [NotificationType.SERVER_RECOVERED]: {
    type: NotificationType.SERVER_RECOVERED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: false
  },
  [NotificationType.GATEWAY_CONNECTED]: {
    type: NotificationType.GATEWAY_CONNECTED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.GATEWAY_DISCONNECTED]: {
    type: NotificationType.GATEWAY_DISCONNECTED,
    category: NotificationCategory.DEVICE_SERVER,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },

  // File Operations
  [NotificationType.FILE_UPLOAD_COMPLETED]: {
    type: NotificationType.FILE_UPLOAD_COMPLETED,
    category: NotificationCategory.FILE_OPERATIONS,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: false
  },
  [NotificationType.FILE_UPLOAD_FAILED]: {
    type: NotificationType.FILE_UPLOAD_FAILED,
    category: NotificationCategory.FILE_OPERATIONS,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },
  [NotificationType.FILE_OPERATION_COMPLETED]: {
    type: NotificationType.FILE_OPERATION_COMPLETED,
    category: NotificationCategory.FILE_OPERATIONS,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.FILE_OPERATION_FAILED]: {
    type: NotificationType.FILE_OPERATION_FAILED,
    category: NotificationCategory.FILE_OPERATIONS,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },

  // Storage
  [NotificationType.STORAGE_WARNING]: {
    type: NotificationType.STORAGE_WARNING,
    category: NotificationCategory.STORAGE,
    defaultSeverity: NotificationSeverity.WARNING,
    isSecurityCritical: false
  },
  [NotificationType.STORAGE_CRITICAL]: {
    type: NotificationType.STORAGE_CRITICAL,
    category: NotificationCategory.STORAGE,
    defaultSeverity: NotificationSeverity.CRITICAL,
    isSecurityCritical: false
  },
  [NotificationType.STORAGE_RECOVERED]: {
    type: NotificationType.STORAGE_RECOVERED,
    category: NotificationCategory.STORAGE,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: false
  },

  // System
  [NotificationType.SERVICE_MAINTENANCE]: {
    type: NotificationType.SERVICE_MAINTENANCE,
    category: NotificationCategory.SYSTEM,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.SERVICE_OUTAGE]: {
    type: NotificationType.SERVICE_OUTAGE,
    category: NotificationCategory.SYSTEM,
    defaultSeverity: NotificationSeverity.CRITICAL,
    isSecurityCritical: false
  },
  [NotificationType.SERVICE_RECOVERED]: {
    type: NotificationType.SERVICE_RECOVERED,
    category: NotificationCategory.SYSTEM,
    defaultSeverity: NotificationSeverity.SUCCESS,
    isSecurityCritical: false
  },
  [NotificationType.SYSTEM_ANNOUNCEMENT]: {
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    category: NotificationCategory.SYSTEM,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  },
  [NotificationType.TEST_NOTIFICATION]: {
    type: NotificationType.TEST_NOTIFICATION,
    category: NotificationCategory.SYSTEM,
    defaultSeverity: NotificationSeverity.INFO,
    isSecurityCritical: false
  }
});

export function getNotificationTypeMeta(type: NotificationType | string): NotificationTypeMeta {
  const meta = NOTIFICATION_TYPE_CATALOG[type as NotificationType];
  if (!meta) {
    return {
      type: type as NotificationType,
      category: NotificationCategory.SYSTEM,
      defaultSeverity: NotificationSeverity.INFO,
      isSecurityCritical: false
    };
  }
  return meta;
}
