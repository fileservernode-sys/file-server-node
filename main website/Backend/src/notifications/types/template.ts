/**
 * RemoteNode Notification Template Engine Contracts
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationType } from './type_registry.js';
import { NotificationChannel } from './channel.js';
import { NotificationSeverity } from './severity.js';
import { NotificationDeepLink } from './deep_link.js';
import { SafeNotificationMetadata } from './event.js';

export interface TemplateContext {
  userName?: string;
  userEmail?: string;
  deviceName?: string;
  serverName?: string;
  fileCount?: number;
  fileName?: string;
  filePath?: string;
  fileSizeBytes?: string;
  ipAddress?: string;
  userAgent?: string;
  storageFreeBytes?: string;
  storageTotalBytes?: string;
  storageUsedPercent?: number;
  reason?: string;
  customSummary?: string;
  timestamp: string;
  [key: string]: any;
}

export interface RenderedTemplate {
  title: string;
  body: string;
  emailSubject: string;
  emailHtml: string;
  emailText: string;
  deepLink?: NotificationDeepLink;
  defaultChannels: NotificationChannel[];
  priority: NotificationSeverity;
}

export interface NotificationTemplate {
  type: NotificationType;
  titleTemplate: (ctx: TemplateContext) => string;
  bodyTemplate: (ctx: TemplateContext) => string;
  emailSubjectTemplate: (ctx: TemplateContext) => string;
  emailHtmlTemplate: (ctx: TemplateContext) => string;
  emailTextTemplate: (ctx: TemplateContext) => string;
  defaultChannels: NotificationChannel[];
  defaultSeverity: NotificationSeverity;
  defaultDeepLink?: (ctx: TemplateContext) => NotificationDeepLink;
}

export function buildTemplateContext(
  metadata: SafeNotificationMetadata = {},
  occurredAt: Date = new Date()
): TemplateContext {
  return {
    userName: metadata.userName ? String(metadata.userName) : 'RemoteNode User',
    userEmail: metadata.userEmail ? String(metadata.userEmail) : '',
    deviceName: metadata.deviceName ? String(metadata.deviceName) : 'Android Phone',
    serverName: metadata.serverName ? String(metadata.serverName) : 'File Server',
    fileCount: metadata.fileCount !== undefined ? Number(metadata.fileCount) : 1,
    fileName: metadata.fileName ? String(metadata.fileName) : 'file',
    filePath: metadata.filePath ? String(metadata.filePath) : '',
    fileSizeBytes: metadata.fileSizeBytes ? String(metadata.fileSizeBytes) : '0 B',
    ipAddress: metadata.ipAddress ? String(metadata.ipAddress) : 'Unknown IP',
    userAgent: metadata.userAgent ? String(metadata.userAgent) : 'RemoteNode Client',
    storageFreeBytes: metadata.storageFreeBytes ? String(metadata.storageFreeBytes) : '',
    storageTotalBytes: metadata.storageTotalBytes ? String(metadata.storageTotalBytes) : '',
    storageUsedPercent: metadata.storageUsedPercent !== undefined ? Number(metadata.storageUsedPercent) : 0,
    reason: metadata.reason ? String(metadata.reason) : '',
    customSummary: metadata.customSummary ? String(metadata.customSummary) : '',
    timestamp: occurredAt.toISOString()
  };
}
