import { prisma } from '../../config/database.js';
import { AppError } from '../../errors/app-error.js';

export const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const DEFAULT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export class AdminLockoutService {
  private static getMaxAttempts(): number {
    const envVal = Number(process.env.ADMIN_LOCKOUT_MAX_ATTEMPTS);
    return !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_MAX_FAILED_ATTEMPTS;
  }

  private static getLockoutDurationMs(): number {
    const envVal = Number(process.env.ADMIN_LOCKOUT_DURATION_MS);
    return !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_LOCKOUT_DURATION_MS;
  }

  /**
   * Constructs composite storage key for lockout tracking
   */
  static getLockoutKey(ip: string, email: string): string {
    return `${ip.trim()}_${email.trim().toLowerCase()}`;
  }

  /**
   * Checks whether the given IP / Email combination is currently locked out.
   * Throws 429 Too Many Requests if currently locked.
   */
  static async checkLockout(ip: string, email: string): Promise<void> {
    const key = this.getLockoutKey(ip, email);
    const now = new Date();

    const record = await prisma.adminLockout.findUnique({
      where: { key }
    });

    if (!record) return;

    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSec = Math.max(1, Math.ceil((record.lockedUntil.getTime() - now.getTime()) / 1000));
      throw new AppError(
        `Too many failed login attempts. Administrative access locked for ${remainingSec} seconds.`,
        429,
        'RATE_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Records a failed login attempt in a persistent, distributed manner.
   * Atomically increments failed attempts and triggers lockout threshold.
   */
  static async recordFailure(ip: string, email: string): Promise<{ locked: boolean; attempts: number }> {
    const key = this.getLockoutKey(ip, email);
    const now = new Date();
    const maxAttempts = this.getMaxAttempts();
    const lockoutDurationMs = this.getLockoutDurationMs();

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.adminLockout.findUnique({
        where: { key }
      });

      // If prior lock expired, reset window
      let currentAttempts = 0;
      if (existing) {
        if (existing.lockedUntil && existing.lockedUntil <= now) {
          currentAttempts = 1;
        } else {
          currentAttempts = existing.failedAttempts + 1;
        }
      } else {
        currentAttempts = 1;
      }

      const shouldLock = currentAttempts >= maxAttempts;
      const lockedUntil = shouldLock ? new Date(now.getTime() + lockoutDurationMs) : null;

      await tx.adminLockout.upsert({
        where: { key },
        create: {
          key,
          failedAttempts: currentAttempts,
          lockedUntil,
          lastAttemptAt: now
        },
        update: {
          failedAttempts: currentAttempts,
          lockedUntil,
          lastAttemptAt: now
        }
      });

      return {
        locked: shouldLock,
        attempts: currentAttempts
      };
    });
  }

  /**
   * Clears failed attempt counters upon successful authentication.
   */
  static async clearLockout(ip: string, email: string): Promise<void> {
    const key = this.getLockoutKey(ip, email);
    await prisma.adminLockout.deleteMany({
      where: { key }
    });
  }
}
