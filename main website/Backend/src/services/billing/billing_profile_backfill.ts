import { prisma } from '../../config/database.js';
import { AuditEventType } from '@prisma/client';
import { appLogger } from '../../observability/logger.js';

export interface BackfillBillingProfileOptions {
  dryRun?: boolean;
  batchSize?: number;
}

export interface BackfillBillingProfileResult {
  totalEventsScanned: number;
  usersEvaluated: number;
  recordsNeedingBackfill: number;
  recordsUpdated: number;
  recordsSkipped: number;
  conflictsDetected: number;
  dryRun: boolean;
}

interface UserHistoricalCandidate {
  latestCompanyName: string | null;
  latestTaxId: string | null;
  allSeenCompanyNames: Set<string>;
  allSeenTaxIds: Set<string>;
  hasConflict: boolean;
}

/**
 * Idempotent, Complete, and Safe Historical Billing Profile Backfill Service
 *
 * Reconciles historical companyName and taxId values recorded in AuditEvent
 * logs into first-class AccountBillingState relational columns.
 *
 * Safety & Integrity Policies:
 * 1. Non-Destructive Conflict Policy: Never overwrites existing non-null relational
 *    columns in AccountBillingState. Existing database values always take precedence.
 * 2. Complete Historical Coverage: Uses cursor-based pagination to inspect ALL historical
 *    audit events, eliminating artificial window truncation.
 * 3. Partial-Update Assembly: Accumulates companyName and taxId independently across
 *    historical events, ensuring that partial profile updates do not discard other fields.
 * 4. Conflict Identification: Detects multiple differing historical entries per user
 *    and flags them for review without corrupting state.
 * 5. Privacy & Security: Emits only aggregated counts and metrics; zero raw tax IDs
 *    or company names are logged.
 * 6. Idempotency: Can be executed repeatedly with zero adverse side effects.
 */
export class BillingProfileBackfillService {
  public static async executeBackfill(
    options: BackfillBillingProfileOptions = {}
  ): Promise<BackfillBillingProfileResult> {
    const dryRun = options.dryRun ?? true;
    const batchSize = options.batchSize ?? 100;

    appLogger.info('[BillingProfileBackfill] Starting comprehensive historical billing profile scan', {
      metadata: {
        dryRun,
        batchSize
      }
    });

    let totalEventsScanned = 0;
    let conflictsDetected = 0;
    const userCandidateMap = new Map<string, UserHistoricalCandidate>();

    // 1. Complete Paginated Historical Audit Scan (Cursor-based)
    let cursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const events = await prisma.auditEvent.findMany({
        where: {
          eventType: AuditEventType.BILLING_STATE_UPDATED
        },
        orderBy: { id: 'desc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
      });

      if (events.length === 0) {
        hasMore = false;
        break;
      }

      totalEventsScanned += events.length;
      cursor = events[events.length - 1].id;

      for (const evt of events) {
        if (!evt.userId) continue;
        const meta = evt.metadata as Record<string, unknown> | null;
        if (!meta || meta.action !== 'UPDATE_BILLING_PROFILE') continue;

        const candidateCompany =
          typeof meta.companyName === 'string' && meta.companyName.trim()
            ? meta.companyName.trim()
            : null;
        const candidateTax =
          typeof meta.taxId === 'string' && meta.taxId.trim()
            ? meta.taxId.trim()
            : null;

        if (!candidateCompany && !candidateTax) continue;

        let candidate = userCandidateMap.get(evt.userId);
        if (!candidate) {
          candidate = {
            latestCompanyName: null,
            latestTaxId: null,
            allSeenCompanyNames: new Set<string>(),
            allSeenTaxIds: new Set<string>(),
            hasConflict: false
          };
          userCandidateMap.set(evt.userId, candidate);
        }

        // Accumulate companyName (events are processed desc, so first non-null is latest)
        if (candidateCompany) {
          if (!candidate.latestCompanyName) {
            candidate.latestCompanyName = candidateCompany;
          } else if (candidate.latestCompanyName !== candidateCompany) {
            candidate.hasConflict = true;
          }
          candidate.allSeenCompanyNames.add(candidateCompany);
        }

        // Accumulate taxId independently (handles partial updates across events)
        if (candidateTax) {
          if (!candidate.latestTaxId) {
            candidate.latestTaxId = candidateTax;
          } else if (candidate.latestTaxId !== candidateTax) {
            candidate.hasConflict = true;
          }
          candidate.allSeenTaxIds.add(candidateTax);
        }
      }

      if (events.length < batchSize) {
        hasMore = false;
      }
    }

    // 2. Evaluate Candidates against AccountBillingState
    const usersEvaluated = userCandidateMap.size;
    let recordsNeedingBackfill = 0;
    let recordsUpdated = 0;
    let recordsSkipped = 0;

    for (const [userId, candidate] of userCandidateMap.entries()) {
      if (candidate.hasConflict) {
        conflictsDetected++;
      }

      const billingState = await prisma.accountBillingState.findUnique({
        where: { userId }
      });

      if (!billingState) {
        recordsSkipped++;
        continue;
      }

      // Conflict policy: only populate if column is currently null; NEVER overwrite existing relational values
      const needsCompanyUpdate = !billingState.companyName && candidate.latestCompanyName !== null;
      const needsTaxUpdate = !billingState.taxId && candidate.latestTaxId !== null;

      if (!needsCompanyUpdate && !needsTaxUpdate) {
        recordsSkipped++;
        continue;
      }

      recordsNeedingBackfill++;

      if (dryRun) {
        recordsUpdated++;
      } else {
        await prisma.accountBillingState.update({
          where: { id: billingState.id },
          data: {
            ...(needsCompanyUpdate ? { companyName: candidate.latestCompanyName } : {}),
            ...(needsTaxUpdate ? { taxId: candidate.latestTaxId } : {})
          }
        });
        recordsUpdated++;
      }
    }

    appLogger.info('[BillingProfileBackfill] Completed historical billing profile scan', {
      metadata: {
        dryRun,
        totalEventsScanned,
        usersEvaluated,
        recordsNeedingBackfill,
        recordsUpdated,
        recordsSkipped,
        conflictsDetected
      }
    });

    return {
      totalEventsScanned,
      usersEvaluated,
      recordsNeedingBackfill,
      recordsUpdated,
      recordsSkipped,
      conflictsDetected,
      dryRun
    };
  }
}
