/**
 * RemoteNode Canonical Severity and Priority Model
 * Track 4 — Batch NT-1.1 Architecture
 */

export enum NotificationSeverity {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  SECURITY = 'SECURITY'
}

export interface SeverityPriorityMapping {
  pushPriority: 'normal' | 'high';
  emailUrgency: 'low' | 'normal' | 'high' | 'immediate';
  uiPresentation: 'standard' | 'highlight' | 'warning' | 'alert' | 'security_badge';
  userCanSuppress: boolean;
}

export const SEVERITY_BEHAVIOR_MAP: Record<NotificationSeverity, SeverityPriorityMapping> = Object.freeze({
  [NotificationSeverity.INFO]: {
    pushPriority: 'normal',
    emailUrgency: 'low',
    uiPresentation: 'standard',
    userCanSuppress: true
  },
  [NotificationSeverity.SUCCESS]: {
    pushPriority: 'normal',
    emailUrgency: 'normal',
    uiPresentation: 'highlight',
    userCanSuppress: true
  },
  [NotificationSeverity.WARNING]: {
    pushPriority: 'normal',
    emailUrgency: 'normal',
    uiPresentation: 'warning',
    userCanSuppress: true
  },
  [NotificationSeverity.CRITICAL]: {
    pushPriority: 'high',
    emailUrgency: 'immediate',
    uiPresentation: 'alert',
    userCanSuppress: false
  },
  [NotificationSeverity.SECURITY]: {
    pushPriority: 'high',
    emailUrgency: 'immediate',
    uiPresentation: 'security_badge',
    userCanSuppress: false
  }
});

export function getSeverityBehavior(severity: NotificationSeverity): SeverityPriorityMapping {
  return SEVERITY_BEHAVIOR_MAP[severity] || SEVERITY_BEHAVIOR_MAP[NotificationSeverity.INFO];
}
