/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — SQL QUERY HISTORY ENGINE
 * Phase 15 Batch 15.4-R1 — Query History Remediation (Security, Privacy & Testability)
 *
 * Provides a clean, pure functional interface for managing per-administrator,
 * browser-local persistent SQL query history.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SqlHistory = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_HISTORY_ENTRIES = 50;
  const MAX_SQL_LENGTH = 10000; // Matches backend SqlSafetyGuard MAX_SQL_LENGTH
  const STORAGE_KEY_PREFIX = 'zdex_admin_sql_history_';
  const VALID_STATUSES = Object.freeze(['SUCCESS', 'ERROR', 'REJECTED', 'TIMEOUT']);

  /**
   * Generates a storage key scoped to a specific administrator.
   * If adminId is missing, null, undefined, empty, or a generic placeholder, returns null.
   * NEVER returns a shared or generic fallback key.
   */
  function getSqlHistoryStorageKey(adminId) {
    if (!adminId || typeof adminId !== 'string') return null;
    const cleanId = adminId.trim();
    if (!cleanId || cleanId === 'undefined' || cleanId === 'null' || cleanId === 'default' || cleanId === 'guest' || cleanId === 'admin') {
      return null;
    }
    return `${STORAGE_KEY_PREFIX}${cleanId}`;
  }

  /**
   * Builds a sanitized, metadata-only history entry.
   * Enforces max SQL length ceiling (10,000 chars) and strict scalar schemas.
   * Ensures no query result rows or cell values are ever included.
   */
  function buildSqlHistoryEntry(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid history entry params');
    }

    const rawSql = params.sql ? String(params.sql).trim().slice(0, MAX_SQL_LENGTH) : '';
    const status = VALID_STATUSES.includes(params.status) ? params.status : 'SUCCESS';

    let validDate = new Date().toISOString();
    if (params.executedAt) {
      const parsed = new Date(params.executedAt);
      if (!isNaN(parsed.getTime())) {
        validDate = parsed.toISOString();
      }
    }

    return {
      id: params.id && typeof params.id === 'string' ? params.id : ('hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      executedAt: validDate,
      sql: rawSql,
      statementType: params.statementType ? String(params.statementType).toUpperCase().slice(0, 32) : 'QUERY',
      status: status,
      executionTimeMs: typeof params.executionTimeMs === 'number' && isFinite(params.executionTimeMs) && params.executionTimeMs >= 0 ? Math.round(params.executionTimeMs) : 0,
      rowCount: typeof params.rowCount === 'number' && isFinite(params.rowCount) && params.rowCount >= 0 ? Math.floor(params.rowCount) : 0,
      truncated: Boolean(params.truncated),
      errorMessage: params.errorMessage ? String(params.errorMessage).slice(0, 500) : null
    };
  }

  /**
   * Appends/prepends a new history entry to an existing array and enforces FIFO bounding.
   * Returns a new array. Does not mutate the input array.
   */
  function recordSqlHistoryEntry(entries, newEntry, maxEntries = MAX_HISTORY_ENTRIES) {
    const list = Array.isArray(entries) ? [...entries] : [];
    const entry = (newEntry && newEntry.id && newEntry.sql !== undefined) ? buildSqlHistoryEntry(newEntry) : buildSqlHistoryEntry(newEntry || {});
    
    list.unshift(entry);
    const limit = typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : MAX_HISTORY_ENTRIES;
    if (list.length > limit) {
      return list.slice(0, limit);
    }
    return list;
  }

  /**
   * Loads query history from a storage provider for a given administrator.
   * Treats browser storage as untrusted input: validates every record against the strict schema.
   * Returns an empty array if adminId is invalid, storage is unavailable, or data is corrupted.
   */
  function loadSqlHistory(storage, adminId) {
    const key = getSqlHistoryStorageKey(adminId);
    if (!key || !storage) return [];

    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const validEntries = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof item.sql === 'string') {
          const sqlText = item.sql.trim().slice(0, MAX_SQL_LENGTH);
          if (sqlText.length === 0) continue;

          let validDate = new Date().toISOString();
          if (item.executedAt) {
            const parsedDate = new Date(item.executedAt);
            if (!isNaN(parsedDate.getTime())) {
              validDate = parsedDate.toISOString();
            }
          }

          validEntries.push({
            id: String(item.id || ('hist_' + Date.now())),
            executedAt: validDate,
            sql: sqlText,
            statementType: String(item.statementType || 'QUERY').toUpperCase().slice(0, 32),
            status: VALID_STATUSES.includes(item.status) ? item.status : 'SUCCESS',
            executionTimeMs: typeof item.executionTimeMs === 'number' && isFinite(item.executionTimeMs) && item.executionTimeMs >= 0 ? Math.round(item.executionTimeMs) : 0,
            rowCount: typeof item.rowCount === 'number' && isFinite(item.rowCount) && item.rowCount >= 0 ? Math.floor(item.rowCount) : 0,
            truncated: Boolean(item.truncated),
            errorMessage: item.errorMessage ? String(item.errorMessage).slice(0, 500) : null
          });

          if (validEntries.length >= MAX_HISTORY_ENTRIES) break;
        }
      }
      return validEntries;
    } catch (_) {
      return [];
    }
  }

  /**
   * Saves query history to a storage provider for a given administrator.
   * Strips any extraneous properties to guarantee metadata-only persistence.
   * Returns boolean indicating success.
   */
  function saveSqlHistory(storage, adminId, entries, maxEntries = MAX_HISTORY_ENTRIES) {
    const key = getSqlHistoryStorageKey(adminId);
    if (!key || !storage) return false;

    try {
      const limit = typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : MAX_HISTORY_ENTRIES;
      const list = Array.isArray(entries) ? entries.slice(0, limit) : [];
      
      const sanitizedList = list.map(item => ({
        id: String(item.id || ('hist_' + Date.now())),
        executedAt: item.executedAt || new Date().toISOString(),
        sql: String(item.sql || '').trim().slice(0, MAX_SQL_LENGTH),
        statementType: String(item.statementType || 'QUERY').toUpperCase().slice(0, 32),
        status: VALID_STATUSES.includes(item.status) ? item.status : 'SUCCESS',
        executionTimeMs: typeof item.executionTimeMs === 'number' && isFinite(item.executionTimeMs) && item.executionTimeMs >= 0 ? Math.round(item.executionTimeMs) : 0,
        rowCount: typeof item.rowCount === 'number' && isFinite(item.rowCount) && item.rowCount >= 0 ? Math.floor(item.rowCount) : 0,
        truncated: Boolean(item.truncated),
        errorMessage: item.errorMessage ? String(item.errorMessage).slice(0, 500) : null
      }));

      storage.setItem(key, JSON.stringify(sanitizedList));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Clears query history for a given administrator.
   */
  function clearSqlHistory(storage, adminId) {
    const key = getSqlHistoryStorageKey(adminId);
    if (!key || !storage) return false;

    try {
      storage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Filters history entries in memory by search query text and status.
   */
  function filterSqlHistory(entries, searchText, statusFilter) {
    if (!Array.isArray(entries)) return [];

    const query = searchText ? String(searchText).trim().toLowerCase() : '';
    const status = statusFilter && statusFilter !== 'ALL' ? String(statusFilter).toUpperCase() : null;

    return entries.filter(entry => {
      if (!entry) return false;
      if (status && entry.status !== status) return false;
      if (query) {
        const matchSql = entry.sql && entry.sql.toLowerCase().includes(query);
        const matchErr = entry.errorMessage && entry.errorMessage.toLowerCase().includes(query);
        const matchStmt = entry.statementType && entry.statementType.toLowerCase().includes(query);
        if (!matchSql && !matchErr && !matchStmt) return false;
      }
      return true;
    });
  }

  return {
    MAX_HISTORY_ENTRIES,
    MAX_SQL_LENGTH,
    STORAGE_KEY_PREFIX,
    getSqlHistoryStorageKey,
    buildSqlHistoryEntry,
    recordSqlHistoryEntry,
    loadSqlHistory,
    saveSqlHistory,
    clearSqlHistory,
    filterSqlHistory
  };
}));

