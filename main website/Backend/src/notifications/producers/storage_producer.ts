import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class StorageEventProducer {
  public async emitStorageWarning(
    userId: string,
    deviceId: string,
    usedBytes: number,
    totalBytes: number
  ): Promise<void> {
    try {
      const percentage = Math.round((usedBytes / (totalBytes || 1)) * 100);
      await notificationService.dispatchEvent({
        eventType: NotificationType.STORAGE_WARNING,
        userId,
        deviceId,
        category: NotificationCategory.STORAGE,
        severity: NotificationSeverity.WARNING,
        metadata: {
          usedBytes,
          totalBytes,
          storageUsagePercent: percentage
        },
        source: 'storage-producer'
      });
    } catch (err) {
      console.warn(`[StorageEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitStorageCritical(
    userId: string,
    deviceId: string,
    usedBytes: number,
    totalBytes: number
  ): Promise<void> {
    try {
      const percentage = Math.round((usedBytes / (totalBytes || 1)) * 100);
      await notificationService.dispatchEvent({
        eventType: NotificationType.STORAGE_CRITICAL,
        userId,
        deviceId,
        category: NotificationCategory.STORAGE,
        severity: NotificationSeverity.CRITICAL,
        metadata: {
          usedBytes,
          totalBytes,
          storageUsagePercent: percentage
        },
        source: 'storage-producer'
      });
    } catch (err) {
      console.warn(`[StorageEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitStorageRecovered(
    userId: string,
    deviceId: string,
    usedBytes: number,
    totalBytes: number
  ): Promise<void> {
    try {
      const percentage = Math.round((usedBytes / (totalBytes || 1)) * 100);
      await notificationService.dispatchEvent({
        eventType: NotificationType.STORAGE_RECOVERED,
        userId,
        deviceId,
        category: NotificationCategory.STORAGE,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          usedBytes,
          totalBytes,
          storageUsagePercent: percentage
        },
        source: 'storage-producer'
      });
    } catch (err) {
      console.warn(`[StorageEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const storageEventProducer = new StorageEventProducer();
