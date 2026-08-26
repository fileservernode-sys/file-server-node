/**
 * RemoteNode Safe Deep-Link Specification
 * Track 4 — Batch NT-1.1 Architecture
 */

export type DeepLinkTargetType = 'account' | 'device' | 'server' | 'file_manager' | 'security' | 'system';

export interface NotificationDeepLink {
  targetType: DeepLinkTargetType;
  uri: string; // e.g. remotenode://server/srv_123, remotenode://filemanager
  webPath?: string; // e.g. /dashboard/servers/srv_123, /file-manager
  params?: Record<string, string>;
}

export function createDeepLink(
  targetType: DeepLinkTargetType,
  uri: string,
  webPath?: string,
  params?: Record<string, string>
): NotificationDeepLink {
  return {
    targetType,
    uri,
    webPath,
    params
  };
}
