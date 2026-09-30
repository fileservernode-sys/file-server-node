import { prisma } from '../config/database.js';
import { ErrorSeverity, IncidentStatus } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import { ErrorSanitizer } from '../utils/error_sanitizer.js';
import { ErrorNormalizer } from '../utils/error_normalizer.js';
import { appLogger } from '../observability/logger.js';

export interface ErrorIngestionInput {
  error?: Error | unknown;
  component?: string; // e.g. 'API', 'DATABASE', 'GATEWAY', 'ANDROID', 'FLUTTER', 'AUTH', 'BILLING', 'EMAIL', 'BACKGROUND_WORKER'
  severity?: ErrorSeverity | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  errorCode?: string;
  errorType?: string;
  message?: string;
  stackTrace?: string;
  occurredAt?: Date | string;
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
  requestId?: string; // Reserved for Phase 12.4
  userId?: string;
  deviceId?: string;
  serverInstanceId?: string;
  gatewayNodeId?: string;
  connectionId?: string;
  sessionId?: string;
  metadata?: Record<string, any> | unknown;
}

export interface ErrorIngestionResult {
  success: boolean;
  fingerprintId?: string;
  fingerprint?: string;
  incidentId?: string;
  occurrenceId?: string;
  createdFingerprint?: boolean;
  createdIncident?: boolean;
  error?: string;
}

const SEVERITY_WEIGHTS: Record<ErrorSeverity, number> = {
  [ErrorSeverity.INFO]: 1,
  [ErrorSeverity.WARNING]: 2,
  [ErrorSeverity.ERROR]: 3,
  [ErrorSeverity.CRITICAL]: 4
};

/**
 * ZDEXCLOUD CENTRAL ERROR INGESTION & FINGERPRINTING SERVICE (Phase 12.3)
 *
 * Core service responsible for normalizing, sanitizing, fingerprinting, deduplicating,
 * and transactionally persisting operational errors into the 3-tier database model:
 *
 *   ErrorFingerprint (Group identity & aggregates)
 *       └── ErrorIncident (Operational lifecycle / triage state)
 *               └── ErrorOccurrence (Granular occurrence event)
 *
 * Critical Invariants:
 * - Observability failure MUST NEVER crash or recursively loop the application.
 * - Zero secrets, credentials, tokens, or customer file contents are stored.
 * - Fingerprint generation is strictly deterministic and independent of volatile runtime values.
 * - Concurrency-safe aggregate updates and severity escalation.
 */
export class ErrorIngestionService {
  private static instance: ErrorIngestionService;

  public static getInstance(): ErrorIngestionService {
    if (!ErrorIngestionService.instance) {
      ErrorIngestionService.instance = new ErrorIngestionService();
    }
    return ErrorIngestionService.instance;
  }

  /**
   * Evaluates higher severity level between existing and incoming severities.
   * Ensures existing error records are never accidentally downgraded by less severe occurrences.
   */
  public static getHigherSeverity(s1: ErrorSeverity, s2: ErrorSeverity): ErrorSeverity {
    const w1 = SEVERITY_WEIGHTS[s1] || 3;
    const w2 = SEVERITY_WEIGHTS[s2] || 3;
    return w2 > w1 ? s2 : s1;
  }

  /**
   * Classifies an incoming error to determine standard component, severity, error code, and error type.
   */
  public classifyError(input: ErrorIngestionInput): {
    component: string;
    severity: ErrorSeverity;
    errorCode: string;
    errorType: string;
    rawMessage: string;
    rawStack: string | null;
  } {
    const err = input.error;
    let component = (input.component || 'API').toUpperCase().trim();
    let severity: ErrorSeverity = ErrorSeverity.ERROR;
    let errorCode = (input.errorCode || '').trim();
    let errorType = (input.errorType || '').trim();
    let rawMessage = (input.message || '').trim();
    let rawStack: string | null = input.stackTrace || null;

    if (err instanceof AppError) {
      errorCode = errorCode || err.errorCode;
      errorType = errorType || err.constructor.name;
      rawMessage = rawMessage || err.message;
      rawStack = rawStack || err.stack || null;
      if (err.statusCode >= 500) {
        severity = ErrorSeverity.ERROR;
      } else if (err.statusCode >= 400) {
        severity = ErrorSeverity.WARNING;
      }
    } else if (err instanceof Error) {
      errorType = errorType || err.name || 'Error';
      rawMessage = rawMessage || err.message;
      rawStack = rawStack || err.stack || null;

      // Classify Prisma Database Errors
      if (
        err.name === 'PrismaClientInitializationError' ||
        err.name === 'PrismaClientKnownRequestError' ||
        err.name === 'PrismaClientUnknownRequestError' ||
        err.name === 'PrismaClientRustPanicError' ||
        err.name === 'PrismaClientValidationError' ||
        (err.message && err.message.includes('database'))
      ) {
        component = 'DATABASE';
        errorCode = errorCode || (err as any).code || 'DATABASE_ERROR';
        severity = ErrorSeverity.ERROR;
      }
    } else if (err && typeof err === 'object') {
      rawMessage = rawMessage || (err as any).message || JSON.stringify(err);
      errorCode = errorCode || (err as any).code || (err as any).errorCode;
      errorType = errorType || (err as any).name || (err as any).type || 'CustomError';
    } else if (typeof err === 'string') {
      rawMessage = rawMessage || err;
    }

    // Default fallbacks
    if (!rawMessage) {
      rawMessage = 'Unknown operational error';
    }
    if (!errorCode) {
      errorCode = input.httpStatus ? `HTTP_${input.httpStatus}` : 'INTERNAL_SERVER_ERROR';
    }
    if (!errorType) {
      errorType = 'OperationalException';
    }

    // Explicit caller severity override takes precedence if valid
    if (input.severity) {
      const upperSev = String(input.severity).toUpperCase() as ErrorSeverity;
      if (SEVERITY_WEIGHTS[upperSev]) {
        severity = upperSev;
      }
    }

    return {
      component,
      severity,
      errorCode,
      errorType,
      rawMessage,
      rawStack
    };
  }

  /**
   * Primary ingestion entry point.
   * Ingests, sanitizes, fingerprints, and transactionally persists operational error records.
   * Fail-safe: Guaranteed never to throw or recursively ingest its own failures.
   */
  public async ingest(input: ErrorIngestionInput): Promise<ErrorIngestionResult> {
    try {
      // 1. Classify error properties
      const classified = this.classifyError(input);

      // 2. Sanitize error message, stack trace, and metadata
      const sanitizedMessage = ErrorSanitizer.sanitizeMessage(classified.rawMessage);
      const sanitizedStackTrace = ErrorSanitizer.sanitizeStackTrace(classified.rawStack);
      const sanitizedMetadata = ErrorSanitizer.sanitizeMetadata(input.metadata);

      // 3. Compute deterministic canonical fingerprint
      const { fingerprint: hash } = ErrorNormalizer.computeFingerprint({
        component: classified.component,
        errorCode: classified.errorCode,
        errorType: classified.errorType,
        rawMessage: sanitizedMessage,
        stackTrace: sanitizedStackTrace,
        httpStatus: input.httpStatus
      });

      const occurrenceTime = input.occurredAt
        ? (input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt))
        : new Date();

      // 4. Atomic Prisma Transaction (Fingerprint + Incident + Occurrence + Aggregate Counters)
      const result = await prisma.$transaction(async (tx) => {
        // A. Find or create ErrorFingerprint
        let fingerprint = await tx.errorFingerprint.findUnique({
          where: { fingerprint: hash }
        });

        let createdFingerprint = false;

        if (!fingerprint) {
          try {
            fingerprint = await tx.errorFingerprint.create({
              data: {
                fingerprint: hash,
                errorCode: classified.errorCode,
                errorType: classified.errorType,
                component: classified.component,
                severity: classified.severity,
                firstSeenAt: occurrenceTime,
                lastSeenAt: occurrenceTime,
                totalOccurrences: 1,
                status: IncidentStatus.OPEN
              }
            });
            createdFingerprint = true;
          } catch (createErr: any) {
            // Handle concurrent creation race condition gracefully
            if (createErr?.code === 'P2002') {
              fingerprint = await tx.errorFingerprint.findUnique({
                where: { fingerprint: hash }
              });
            } else {
              throw createErr;
            }
          }
        }

        if (!fingerprint) {
          throw new Error('Failed to acquire or create ErrorFingerprint record');
        }

        // B. Update aggregate counters & severity on existing fingerprint
        if (!createdFingerprint) {
          const escalatedSeverity = ErrorIngestionService.getHigherSeverity(
            fingerprint.severity,
            classified.severity
          );

          fingerprint = await tx.errorFingerprint.update({
            where: { id: fingerprint.id },
            data: {
              lastSeenAt: occurrenceTime,
              totalOccurrences: { increment: 1 },
              severity: escalatedSeverity,
              // If previously resolved and new error occurs, reopen fingerprint
              status: fingerprint.status === IncidentStatus.RESOLVED ? IncidentStatus.OPEN : fingerprint.status
            }
          });
        }

        // C. Find or create active ErrorIncident (reuse OPEN or ACKNOWLEDGED incident)
        let incident = await tx.errorIncident.findFirst({
          where: {
            fingerprintId: fingerprint.id,
            status: { in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED] }
          },
          orderBy: { updatedAt: 'desc' }
        });

        let createdIncident = false;

        if (!incident) {
          const titleSummary = sanitizedMessage.length > 120
            ? `${sanitizedMessage.substring(0, 117)}...`
            : sanitizedMessage;

          incident = await tx.errorIncident.create({
            data: {
              fingerprintId: fingerprint.id,
              status: IncidentStatus.OPEN,
              severity: fingerprint.severity,
              title: `[${classified.component}] ${classified.errorCode}: ${titleSummary}`,
              summary: sanitizedMessage
            }
          });
          createdIncident = true;
        } else {
          // Escalate incident severity if incoming occurrence is more severe
          const escalatedIncSeverity = ErrorIngestionService.getHigherSeverity(
            incident.severity,
            classified.severity
          );

          if (escalatedIncSeverity !== incident.severity) {
            incident = await tx.errorIncident.update({
              where: { id: incident.id },
              data: { severity: escalatedIncSeverity }
            });
          }
        }

        // D. Create granular ErrorOccurrence record
        const occurrence = await tx.errorOccurrence.create({
          data: {
            fingerprintId: fingerprint.id,
            incidentId: incident.id,
            occurredAt: occurrenceTime,
            component: classified.component,
            severity: classified.severity,
            errorCode: classified.errorCode,
            errorType: classified.errorType,
            message: sanitizedMessage,
            stackTrace: sanitizedStackTrace,
            httpMethod: input.httpMethod ? input.httpMethod.toUpperCase().trim() : undefined,
            httpPath: input.httpPath ? input.httpPath.trim() : undefined,
            httpStatus: typeof input.httpStatus === 'number' ? input.httpStatus : undefined,
            requestId: input.requestId ? input.requestId.trim() : undefined,
            userId: input.userId || undefined,
            deviceId: input.deviceId || undefined,
            serverInstanceId: input.serverInstanceId || undefined,
            gatewayNodeId: input.gatewayNodeId || undefined,
            connectionId: input.connectionId || undefined,
            sessionId: input.sessionId || undefined,
            metadata: sanitizedMetadata
          }
        });

        return {
          fingerprintId: fingerprint.id,
          fingerprint: fingerprint.fingerprint,
          incidentId: incident.id,
          occurrenceId: occurrence.id,
          createdFingerprint,
          createdIncident
        };
      });

      return {
        success: true,
        ...result
      };
    } catch (ingestionError: any) {
      // Hard Safety Invariant: Failure in error ingestion MUST NOT crash the host process or loop recursively!
      appLogger.warn('Operational error ingestion failed', {
        operation: 'ERROR_INGESTION_FAILED',
        metadata: {
          errorMessage: ingestionError?.message,
          errorName: ingestionError?.name
        }
      });

      return {
        success: false,
        error: ingestionError?.message || 'Error ingestion failed'
      };
    }
  }
}

export const errorIngestionService = ErrorIngestionService.getInstance();
