import { prisma } from '../config/database.js';
import { emailService } from './email.js';
import {
  generateOtpCode,
  hashOtp,
  verifyOtpCode,
  generateSessionToken,
  hashSessionToken
} from '../utils/crypto.js';
import { OtpPurpose } from '@prisma/client';

export const YOUM_PANEL_AUTHORIZED_EMAIL = 'fileservernode@gmail.com';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds

export interface YoumAnalyticsTimeSeriesPoint {
  key: string;
  label: string;
  timestamp: string;
  users: number;
  serversCreated: number;
  emailsSent: number;
  emailsFailed: number;
  proMonthly: number;
  proYearly: number;
}

export interface YoumAnalyticsSummary {
  kpis: {
    totalUsers: number;
    totalServersCreated: number;
    totalServersOnline: number;
    totalServersStopped: number;
    totalServersError: number;
    totalEmailsSent: number;
    totalEmailsFailed: number;
    totalEmailsTotal: number;
    totalProMonthlyAccounts: number;
    totalProYearlyAccounts: number;
    totalActiveFreeAccounts: number;
    totalDevicesOnline: number;
    totalDevicesTotal: number;
    periodNewUsers: number;
    periodNewServers: number;
    periodEmailsSent: number;
    periodEmailsFailed: number;
  };
  filter: {
    range: string;
    interval: 'hour' | 'day' | 'month';
    startDate: string;
    endDate: string;
  };
  timeSeries: YoumAnalyticsTimeSeriesPoint[];
  breakdowns: {
    serverStatus: {
      running: number;
      stopped: number;
      error: number;
    };
    subscriptions: {
      proMonthly: number;
      proYearly: number;
      free: number;
    };
    emailStatus: {
      sent: number;
      failed: number;
    };
  };
  recentActivity: {
    users: Array<{
      id: string;
      email: string;
      fullName: string | null;
      status: string;
      emailVerified: boolean;
      createdAt: string;
      planName: string;
    }>;
    servers: Array<{
      id: string;
      serverName: string | null;
      status: string;
      startedAt: string | null;
      createdAt: string;
      deviceName: string | null;
      ownerEmail: string | null;
    }>;
    emails: Array<{
      id: string;
      recipientEmail: string;
      subject: string;
      emailType: string;
      status: string;
      createdAt: string;
    }>;
  };
}

export class YoumPanelService {
  /**
   * Normalizes and validates whether the given email is the authorized Youm Panel Master email.
   */
  public static isAuthorizedEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    return email.trim().toLowerCase() === YOUM_PANEL_AUTHORIZED_EMAIL;
  }

  /**
   * Requests a login OTP for fileservernode@gmail.com.
   * Rejects any other email with strict authorization denial.
   */
  public static async requestOtp(email: string): Promise<{ success: boolean; cooldownSeconds: number }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (cleanEmail !== YOUM_PANEL_AUTHORIZED_EMAIL) {
      const err = new Error('Access denied. Youm Panel is exclusively accessible by fileservernode@gmail.com.');
      (err as any).statusCode = 403;
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    // Ensure User entity exists for fileservernode@gmail.com
    let user = await prisma.user.findUnique({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: YOUM_PANEL_AUTHORIZED_EMAIL,
          fullName: 'Youm Master Administrator',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
    }

    // Check cooldown
    const recentOtp = await prisma.emailOtp.findFirst({
      where: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        purpose: OtpPurpose.LOGIN_2FA,
        createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (recentOtp && !recentOtp.used) {
      const elapsedMs = Date.now() - recentOtp.createdAt.getTime();
      const remainingSec = Math.max(1, Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000));
      const err = new Error(`Please wait ${remainingSec} seconds before requesting a new login code.`);
      (err as any).statusCode = 429;
      (err as any).code = 'RESEND_COOLDOWN_ACTIVE';
      throw err;
    }

    // Invalidate existing unused login OTPs
    await prisma.emailOtp.updateMany({
      where: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        purpose: OtpPurpose.LOGIN_2FA,
        used: false
      },
      data: { used: true }
    });

    const otpCode = generateOtpCode();
    const hashedOtp = hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await prisma.emailOtp.create({
      data: {
        userId: user.id,
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        otpCode: hashedOtp,
        purpose: OtpPurpose.LOGIN_2FA,
        expiresAt,
        attempts: 0,
        used: false
      }
    });

    // Send styled branded notification email
    const subject = `[Youm Panel] Admin Login Passcode: ${otpCode}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #0F172A; color: #F8FAFC; border-radius: 12px; padding: 32px; border: 1px solid #1E293B;">
        <div style="margin-bottom: 24px; text-align: center;">
          <h1 style="color: #38BDF8; font-size: 24px; font-weight: 700; margin: 0 0 6px 0; letter-spacing: -0.5px;">Youm Panel Access</h1>
          <p style="color: #94A3B8; font-size: 14px; margin: 0;">Master Operations &amp; System Analytics</p>
        </div>
        <div style="background: #1E293B; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px; border: 1px solid #334155;">
          <p style="color: #CBD5E1; font-size: 14px; margin: 0 0 12px 0;">Use the following one-time passcode to authenticate:</p>
          <div style="font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #38BDF8; font-family: monospace; background: #0F172A; padding: 14px 20px; border-radius: 6px; display: inline-block; border: 1px dashed #0284C7;">
            ${otpCode}
          </div>
          <p style="color: #64748B; font-size: 12px; margin: 14px 0 0 0;">This passcode expires in 10 minutes and can only be used once.</p>
        </div>
        <p style="color: #94A3B8; font-size: 13px; line-height: 1.5; margin: 0;">
          Security Alert: This code grants unrestricted administrative visibility into users, servers, subscriptions, and system communications. If you did not initiate this login request, no action is required.
        </p>
      </div>
    `;
    const text = `Youm Panel Master Login Passcode: ${otpCode}\n\nThis code is valid for 10 minutes and grants administrative access to Youm Panel.`;

    await emailService.sendRawMail(YOUM_PANEL_AUTHORIZED_EMAIL, subject, html, text, {
      userId: user.id,
      sourcePipeline: 'OTP',
      emailType: 'YOUM_PANEL_LOGIN_OTP',
      templateId: 'YOUM_PANEL_2FA'
    }).catch(err => {
      console.error('[YoumPanelService] Failed to dispatch OTP email:', err);
    });

    return { success: true, cooldownSeconds: 30 };
  }

  /**
   * Verifies the OTP code and returns an authenticated Youm Panel session token.
   */
  public static async verifyOtp(email: string, code: string): Promise<{ token: string; email: string; expiresAt: string }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (cleanEmail !== YOUM_PANEL_AUTHORIZED_EMAIL) {
      const err = new Error('Access denied. Youm Panel is exclusively accessible by fileservernode@gmail.com.');
      (err as any).statusCode = 403;
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    const cleanCode = (code || '').trim();
    if (!cleanCode || cleanCode.length !== 6) {
      const err = new Error('A valid 6-digit numeric verification code is required.');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const otpRecord = await prisma.emailOtp.findFirst({
      where: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        purpose: OtpPurpose.LOGIN_2FA,
        used: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) {
      const err = new Error('No active verification code found. Please request a new code.');
      (err as any).statusCode = 400;
      (err as any).code = 'NO_ACTIVE_OTP';
      throw err;
    }

    if (otpRecord.expiresAt < new Date()) {
      await prisma.emailOtp.update({ where: { id: otpRecord.id }, data: { used: true } });
      const err = new Error('The verification code has expired. Please request a new code.');
      (err as any).statusCode = 400;
      (err as any).code = 'EXPIRED_OTP';
      throw err;
    }

    if (otpRecord.attempts >= 5) {
      await prisma.emailOtp.update({ where: { id: otpRecord.id }, data: { used: true } });
      const err = new Error('Too many invalid attempts. This code has been invalidated. Please request a new code.');
      (err as any).statusCode = 429;
      (err as any).code = 'TOO_MANY_ATTEMPTS';
      throw err;
    }

    const isValid = verifyOtpCode(cleanCode, otpRecord.otpCode);
    if (!isValid) {
      await prisma.emailOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } }
      });
      const err = new Error('Invalid verification code. Please check and try again.');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_OTP';
      throw err;
    }

    // Mark OTP as consumed
    await prisma.emailOtp.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    // Create a 24-hour master session
    const rawToken = generateSessionToken();
    const token = `youm_${rawToken}`;
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.userSession.create({
      data: {
        userId: otpRecord.userId,
        tokenHash,
        expiresAt
      }
    });

    return {
      token,
      email: YOUM_PANEL_AUTHORIZED_EMAIL,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Validates a Youm Panel bearer token.
   */
  public static async validateToken(token: string): Promise<boolean> {
    if (!token || typeof token !== 'string') return false;
    const cleanToken = token.trim();
    if (!cleanToken.startsWith('youm_')) return false;

    const tokenHash = hashSessionToken(cleanToken);
    const session = await prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!session) return false;
    if (session.expiresAt < new Date()) return false;
    if (!session.user || session.user.email.toLowerCase() !== YOUM_PANEL_AUTHORIZED_EMAIL) return false;

    return true;
  }

  /**
   * Logs out / revokes the token.
   */
  public static async revokeToken(token: string): Promise<void> {
    if (!token || typeof token !== 'string') return;
    const cleanToken = token.trim();
    if (!cleanToken.startsWith('youm_')) return;
    const tokenHash = hashSessionToken(cleanToken);
    await prisma.userSession.deleteMany({
      where: { tokenHash }
    }).catch(() => {});
  }

  /**
   * Aggregates and returns full analytics metrics switchable by time range and interval.
   */
  public static async getAnalytics(
    timeRangeParam?: string,
    intervalParam?: string
  ): Promise<YoumAnalyticsSummary> {
    const now = new Date();
    const range = (timeRangeParam || '30d').toLowerCase();

    // Determine start date
    let startDate = new Date();
    let defaultInterval: 'hour' | 'day' | 'month' = 'day';

    switch (range) {
      case '24h':
      case 'daily':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        defaultInterval = 'hour';
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        defaultInterval = 'day';
        break;
      case '30d':
      case 'days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        defaultInterval = 'day';
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        defaultInterval = 'day';
        break;
      case '12m':
      case 'months':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        defaultInterval = 'month';
        break;
      case 'all':
        startDate = new Date(2025, 0, 1);
        defaultInterval = 'month';
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        defaultInterval = 'day';
        break;
    }

    const interval: 'hour' | 'day' | 'month' =
      intervalParam === 'hour' || intervalParam === 'day' || intervalParam === 'month'
        ? intervalParam
        : defaultInterval;

    // Parallel KPI queries
    const [
      totalUsers,
      totalServersCreated,
      totalServersOnline,
      totalServersStopped,
      totalServersError,
      totalEmailsSent,
      totalEmailsFailed,
      totalEmailsTotal,
      totalProMonthlyAccounts,
      totalProYearlyAccounts,
      totalDevicesOnline,
      totalDevicesTotal,
      periodUsers,
      periodServers,
      periodEmails,
      periodSubscriptions
    ] = await Promise.all([
      prisma.user.count(),
      prisma.serverInstance.count(),
      prisma.serverInstance.count({ where: { status: 'RUNNING' } }),
      prisma.serverInstance.count({ where: { status: 'STOPPED' } }),
      prisma.serverInstance.count({ where: { status: 'ERROR' } }),
      prisma.emailMessage.count({ where: { status: { in: ['SENT', 'DELIVERED'] } } }),
      prisma.emailMessage.count({ where: { status: 'FAILED' } }),
      prisma.emailMessage.count(),
      prisma.subscription.count({ where: { status: 'ACTIVE', billingInterval: 'MONTHLY' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE', billingInterval: 'YEARLY' } }),
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count(),
      prisma.user.findMany({
        where: { createdAt: { gte: startDate, lte: now } },
        select: { createdAt: true }
      }),
      prisma.serverInstance.findMany({
        where: { createdAt: { gte: startDate, lte: now } },
        select: { createdAt: true }
      }),
      prisma.emailMessage.findMany({
        where: { createdAt: { gte: startDate, lte: now } },
        select: { createdAt: true, status: true }
      }),
      prisma.subscription.findMany({
        where: { createdAt: { gte: startDate, lte: now } },
        select: { createdAt: true, billingInterval: true }
      })
    ]);

    const totalActiveFreeAccounts = Math.max(0, totalUsers - (totalProMonthlyAccounts + totalProYearlyAccounts));

    // Construct continuous buckets
    const bucketMap = new Map<string, YoumAnalyticsTimeSeriesPoint>();

    const formatBucketKey = (d: Date, intv: 'hour' | 'day' | 'month'): { key: string; label: string } => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hour = String(d.getHours()).padStart(2, '0');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      if (intv === 'hour') {
        return {
          key: `${year}-${month}-${day} ${hour}:00`,
          label: `${hour}:00`
        };
      }
      if (intv === 'day') {
        return {
          key: `${year}-${month}-${day}`,
          label: `${monthNames[d.getMonth()]} ${d.getDate()}`
        };
      }
      return {
        key: `${year}-${month}`,
        label: `${monthNames[d.getMonth()]} ${year}`
      };
    };

    // Pre-seed buckets continuously from startDate to now
    const stepDate = new Date(startDate);
    while (stepDate <= now) {
      const { key, label } = formatBucketKey(stepDate, interval);
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          key,
          label,
          timestamp: stepDate.toISOString(),
          users: 0,
          serversCreated: 0,
          emailsSent: 0,
          emailsFailed: 0,
          proMonthly: 0,
          proYearly: 0
        });
      }

      if (interval === 'hour') {
        stepDate.setHours(stepDate.getHours() + 1);
      } else if (interval === 'day') {
        stepDate.setDate(stepDate.getDate() + 1);
      } else {
        stepDate.setMonth(stepDate.getMonth() + 1);
      }
    }

    // Populate data into buckets
    for (const u of periodUsers) {
      const { key } = formatBucketKey(u.createdAt, interval);
      const point = bucketMap.get(key);
      if (point) point.users += 1;
    }

    for (const s of periodServers) {
      const { key } = formatBucketKey(s.createdAt, interval);
      const point = bucketMap.get(key);
      if (point) point.serversCreated += 1;
    }

    let periodEmailsSent = 0;
    let periodEmailsFailed = 0;
    for (const e of periodEmails) {
      const { key } = formatBucketKey(e.createdAt, interval);
      const point = bucketMap.get(key);
      if (e.status === 'SENT' || e.status === 'DELIVERED') {
        periodEmailsSent += 1;
        if (point) point.emailsSent += 1;
      } else if (e.status === 'FAILED') {
        periodEmailsFailed += 1;
        if (point) point.emailsFailed += 1;
      }
    }

    for (const sub of periodSubscriptions) {
      const { key } = formatBucketKey(sub.createdAt, interval);
      const point = bucketMap.get(key);
      if (point) {
        if (sub.billingInterval === 'MONTHLY') point.proMonthly += 1;
        if (sub.billingInterval === 'YEARLY') point.proYearly += 1;
      }
    }

    const timeSeries = Array.from(bucketMap.values());

    // Fetch Recent Activity for deep inspection
    const [recentUsersRaw, recentServersRaw, recentEmailsRaw] = await Promise.all([
      prisma.user.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: {
          subscriptions: {
            where: { status: 'ACTIVE' },
            take: 1,
            select: { billingInterval: true }
          }
        }
      }),
      prisma.serverInstance.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: {
          device: {
            include: {
              user: {
                select: { email: true }
              }
            }
          }
        }
      }),
      prisma.emailMessage.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          recipientEmail: true,
          subject: true,
          emailType: true,
          status: true,
          createdAt: true
        }
      })
    ]);

    const recentUsers = recentUsersRaw.map(u => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt.toISOString(),
      planName: u.subscriptions.length > 0
        ? `Pro (${u.subscriptions[0].billingInterval.toLowerCase()})`
        : 'Free'
    }));

    const recentServers = recentServersRaw.map(s => ({
      id: s.id,
      serverName: s.serverName,
      status: s.status,
      startedAt: s.startedAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
      deviceName: s.device?.deviceName || null,
      ownerEmail: s.device?.user?.email || null
    }));

    const recentEmails = recentEmailsRaw.map(e => ({
      id: e.id,
      recipientEmail: e.recipientEmail,
      subject: e.subject,
      emailType: e.emailType,
      status: e.status,
      createdAt: e.createdAt.toISOString()
    }));

    return {
      kpis: {
        totalUsers,
        totalServersCreated,
        totalServersOnline,
        totalServersStopped,
        totalServersError,
        totalEmailsSent,
        totalEmailsFailed,
        totalEmailsTotal,
        totalProMonthlyAccounts,
        totalProYearlyAccounts,
        totalActiveFreeAccounts,
        totalDevicesOnline,
        totalDevicesTotal,
        periodNewUsers: periodUsers.length,
        periodNewServers: periodServers.length,
        periodEmailsSent,
        periodEmailsFailed
      },
      filter: {
        range,
        interval,
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      timeSeries,
      breakdowns: {
        serverStatus: {
          running: totalServersOnline,
          stopped: totalServersStopped,
          error: totalServersError
        },
        subscriptions: {
          proMonthly: totalProMonthlyAccounts,
          proYearly: totalProYearlyAccounts,
          free: totalActiveFreeAccounts
        },
        emailStatus: {
          sent: totalEmailsSent,
          failed: totalEmailsFailed
        }
      },
      recentActivity: {
        users: recentUsers,
        servers: recentServers,
        emails: recentEmails
      }
    };
  }
}
