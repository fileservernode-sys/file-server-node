import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class FileEventProducer {
  public async emitFileUploadCompleted(
    userId: string,
    serverId: string,
    filename: string,
    fileSize?: number
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.FILE_UPLOAD_COMPLETED,
        userId,
        serverId,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          filename,
          fileSize: fileSize || 0
        },
        source: 'file-producer'
      });
    } catch (err) {
      console.warn(`[FileEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitFileUploadFailed(
    userId: string,
    serverId: string,
    filename: string,
    reason?: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.FILE_UPLOAD_FAILED,
        userId,
        serverId,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.WARNING,
        metadata: {
          filename,
          reason: reason || 'Transfer error'
        },
        source: 'file-producer'
      });
    } catch (err) {
      console.warn(`[FileEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitFileOperationCompleted(
    userId: string,
    serverId: string,
    operationType: string,
    fileCount: number = 1
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.FILE_OPERATION_COMPLETED,
        userId,
        serverId,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.INFO,
        metadata: {
          operationType,
          fileCount
        },
        source: 'file-producer'
      });
    } catch (err) {
      console.warn(`[FileEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitFileOperationFailed(
    userId: string,
    serverId: string,
    operationType: string,
    reason?: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.FILE_OPERATION_FAILED,
        userId,
        serverId,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.WARNING,
        metadata: {
          operationType,
          reason: reason || 'Operation error'
        },
        source: 'file-producer'
      });
    } catch (err) {
      console.warn(`[FileEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const fileEventProducer = new FileEventProducer();
