import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * ZDEXCLOUD OBSERVABILITY & ERROR CENTER — REQUEST CONTEXT (Phase 12.4)
 * Lightweight AsyncLocalStorage request context store for non-intrusive correlation.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  adminId?: string;
  deviceId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  /**
   * Executes the provided callback within the scope of the given RequestContext.
   */
  run<R>(context: RequestContext, fn: () => R): R {
    return asyncLocalStorage.run(context, fn);
  },

  /**
   * Retrieves the current active RequestContext, or undefined if called outside an active request scope.
   */
  get(): RequestContext | undefined {
    return asyncLocalStorage.getStore();
  },

  /**
   * Retrieves the current effective requestId, or undefined if called outside an active request scope.
   */
  getRequestId(): string | undefined {
    return asyncLocalStorage.getStore()?.requestId;
  }
};
