/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — SQL SAVED QUERIES ENGINE
 * Phase 15 Batch 15.5 — Professional Saved Queries
 *
 * Provides a clean, pure functional interface for managing per-administrator,
 * browser-local persistent Saved SQL Queries.
 *
 * Security & Boundary Invariants:
 * 1. Per-Administrator Isolation: Keys prefixed by `zdex_admin_sql_saved_queries_${adminId}`.
 * 2. No Fallback Keys: Generic or missing admin IDs unconditionally return null and abort.
 * 3. Exact SQL Preservation: Preserves user-submitted SQL text without destructive regex rewriting.
 * 4. Zero Result Persistence: Metadata-only definitions. Never stores rows, cells, or execution records.
 * 5. Safe Input Validation: Enforces bounded lengths, scalar validation, and duplicate-name protection.
 * 6. Untrusted Storage Recovery: Recovers safely from malformed or corrupted storage data.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SqlSavedQueries = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_SAVED_QUERIES = 100;
  const MAX_SQL_LENGTH = 10000; // Matches backend SqlSafetyGuard MAX_SQL_LENGTH
  const MAX_NAME_LENGTH = 100;
  const MAX_DESCRIPTION_LENGTH = 500;
  const STORAGE_KEY_PREFIX = 'zdex_admin_sql_saved_queries_';
  const FORBIDDEN_ADMIN_IDS = Object.freeze(['undefined', 'null', 'default', 'guest', 'admin']);

  /**
   * Generates a storage key scoped to a specific administrator.
   * If adminId is missing, null, undefined, empty, or a generic placeholder, returns null.
   * NEVER returns a shared or generic fallback key.
   */
  function getSqlSavedQueriesStorageKey(adminId) {
    if (!adminId || typeof adminId !== 'string') return null;
    const cleanId = adminId.trim();
    if (!cleanId || FORBIDDEN_ADMIN_IDS.includes(cleanId.toLowerCase())) {
      return null;
    }
    return `${STORAGE_KEY_PREFIX}${cleanId}`;
  }

  /**
   * Builds a sanitized, metadata-only saved query entry.
   * Validates name (required, max 100), sql (required, max 10,000), description (optional, max 500).
   * Strips any extraneous properties to guarantee 0 result data is ever stored.
   */
  function buildSqlSavedQueryEntry(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid saved query parameters');
    }

    // Name Validation
    if (!params.name || typeof params.name !== 'string') {
      throw new Error('Saved query name is required');
    }
    const cleanName = params.name.trim();
    if (cleanName.length === 0) {
      throw new Error('Saved query name cannot be empty');
    }
    if (cleanName.length > MAX_NAME_LENGTH) {
      throw new Error(`Saved query name exceeds maximum length of ${MAX_NAME_LENGTH} characters`);
    }

    // SQL Validation
    if (!params.sql || typeof params.sql !== 'string') {
      throw new Error('SQL query text is required');
    }
    const cleanSql = params.sql.trim();
    if (cleanSql.length === 0) {
      throw new Error('SQL query text cannot be empty');
    }
    if (cleanSql.length > MAX_SQL_LENGTH) {
      throw new Error(`SQL query text exceeds maximum allowed length of ${MAX_SQL_LENGTH} characters`);
    }

    // Description Validation
    let cleanDesc = null;
    if (params.description && typeof params.description === 'string') {
      const trimmedDesc = params.description.trim();
      if (trimmedDesc.length > 0) {
        cleanDesc = trimmedDesc.slice(0, MAX_DESCRIPTION_LENGTH);
      }
    }

    // Timestamps
    const nowIso = new Date().toISOString();
    let createdAt = nowIso;
    if (params.createdAt) {
      const parsed = new Date(params.createdAt);
      if (!isNaN(parsed.getTime())) {
        createdAt = parsed.toISOString();
      }
    }

    let updatedAt = createdAt;
    if (params.updatedAt) {
      const parsed = new Date(params.updatedAt);
      if (!isNaN(parsed.getTime())) {
        updatedAt = parsed.toISOString();
      }
    }

    const id = params.id && typeof params.id === 'string' && params.id.trim().length > 0
      ? params.id.trim()
      : ('sq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

    return {
      id,
      name: cleanName,
      description: cleanDesc,
      sql: cleanSql,
      createdAt,
      updatedAt
    };
  }

  /**
   * Loads saved queries from a storage provider for a given administrator.
   * Treats browser storage as untrusted input: validates every record against the strict schema.
   * Returns an empty array if adminId is invalid, storage is unavailable, or data is corrupted.
   */
  function loadSqlSavedQueries(storage, adminId) {
    const key = getSqlSavedQueriesStorageKey(adminId);
    if (!key || !storage) return [];

    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const validEntries = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof item.name === 'string' && typeof item.sql === 'string') {
          const name = item.name.trim().slice(0, MAX_NAME_LENGTH);
          const sql = item.sql.trim().slice(0, MAX_SQL_LENGTH);
          if (name.length === 0 || sql.length === 0) continue;

          let desc = null;
          if (item.description && typeof item.description === 'string') {
            const trimmed = item.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
            if (trimmed.length > 0) desc = trimmed;
          }

          let createdAt = new Date().toISOString();
          if (item.createdAt) {
            const parsedCreated = new Date(item.createdAt);
            if (!isNaN(parsedCreated.getTime())) createdAt = parsedCreated.toISOString();
          }

          let updatedAt = createdAt;
          if (item.updatedAt) {
            const parsedUpdated = new Date(item.updatedAt);
            if (!isNaN(parsedUpdated.getTime())) updatedAt = parsedUpdated.toISOString();
          }

          validEntries.push({
            id: String(item.id || ('sq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7))),
            name,
            description: desc,
            sql,
            createdAt,
            updatedAt
          });

          if (validEntries.length >= MAX_SAVED_QUERIES) break;
        }
      }

      // Deterministic sort: updatedAt descending
      validEntries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return validEntries;
    } catch (_) {
      return [];
    }
  }

  /**
   * Saves saved queries to a storage provider for a given administrator.
   * Strips any extraneous properties to guarantee 0 result rows or cell data are ever stored.
   * Returns boolean indicating success.
   */
  function saveSqlSavedQueries(storage, adminId, queries, maxQueries = MAX_SAVED_QUERIES) {
    const key = getSqlSavedQueriesStorageKey(adminId);
    if (!key || !storage) return false;

    try {
      const limit = typeof maxQueries === 'number' && maxQueries > 0 ? maxQueries : MAX_SAVED_QUERIES;
      const list = Array.isArray(queries) ? queries.slice(0, limit) : [];

      const sanitizedList = list.map(item => {
        const entry = buildSqlSavedQueryEntry(item);
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          sql: entry.sql,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        };
      });

      storage.setItem(key, JSON.stringify(sanitizedList));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Creates and persists a new saved query for a given administrator.
   * Validates name uniqueness (case-insensitive) within the admin's scope.
   * Throws an error on duplicate name, validation failure, or capacity overflow.
   */
  function createSqlSavedQuery(storage, adminId, queryData) {
    const key = getSqlSavedQueriesStorageKey(adminId);
    if (!key || !storage) {
      throw new Error('Authentication required to save query');
    }

    const currentQueries = loadSqlSavedQueries(storage, adminId);
    if (currentQueries.length >= MAX_SAVED_QUERIES) {
      throw new Error(`Maximum saved query limit (${MAX_SAVED_QUERIES}) reached. Please delete old saved queries.`);
    }

    const entry = buildSqlSavedQueryEntry(queryData);

    // Duplicate-name validation (case-insensitive)
    const duplicate = currentQueries.find(q => q.name.toLowerCase() === entry.name.toLowerCase());
    if (duplicate) {
      throw new Error(`A saved query named "${entry.name}" already exists. Please choose a unique name.`);
    }

    currentQueries.unshift(entry);
    saveSqlSavedQueries(storage, adminId, currentQueries);
    return entry;
  }

  /**
   * Updates an existing saved query definition.
   * Validates name uniqueness (if changed) against all other saved queries.
   * Updates `updatedAt` to the current timestamp.
   */
  function updateSqlSavedQuery(storage, adminId, id, updateData) {
    const key = getSqlSavedQueriesStorageKey(adminId);
    if (!key || !storage) {
      throw new Error('Authentication required to update saved query');
    }

    if (!id || typeof id !== 'string') {
      throw new Error('Valid saved query ID is required');
    }

    const currentQueries = loadSqlSavedQueries(storage, adminId);
    const targetIdx = currentQueries.findIndex(q => q.id === id);
    if (targetIdx === -1) {
      throw new Error('Saved query not found');
    }

    const existing = currentQueries[targetIdx];
    const newName = updateData.name !== undefined ? String(updateData.name).trim() : existing.name;
    const newSql = updateData.sql !== undefined ? String(updateData.sql).trim() : existing.sql;
    const newDesc = updateData.description !== undefined ? (updateData.description ? String(updateData.description).trim() : null) : existing.description;

    // Check duplicate name against other queries
    if (newName.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = currentQueries.find(q => q.id !== id && q.name.toLowerCase() === newName.toLowerCase());
      if (duplicate) {
        throw new Error(`A saved query named "${newName}" already exists. Please choose a unique name.`);
      }
    }

    const updatedEntry = buildSqlSavedQueryEntry({
      id: existing.id,
      name: newName,
      description: newDesc,
      sql: newSql,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    });

    currentQueries[targetIdx] = updatedEntry;
    // Re-sort so most recently updated appears first
    currentQueries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    saveSqlSavedQueries(storage, adminId, currentQueries);
    return updatedEntry;
  }

  /**
   * Deletes a saved query by ID for a given administrator.
   * Returns true if deleted, false if not found or unauthorized.
   */
  function deleteSqlSavedQuery(storage, adminId, id) {
    const key = getSqlSavedQueriesStorageKey(adminId);
    if (!key || !storage || !id) return false;

    const currentQueries = loadSqlSavedQueries(storage, adminId);
    const initialLen = currentQueries.length;
    const filtered = currentQueries.filter(q => q.id !== id);

    if (filtered.length === initialLen) {
      return false;
    }

    saveSqlSavedQueries(storage, adminId, filtered);
    return true;
  }

  /**
   * Filters and searches saved queries by text matching name, description, or SQL.
   * Returns matching items sorted by `updatedAt` descending.
   */
  function filterSqlSavedQueries(queries, searchText) {
    if (!Array.isArray(queries)) return [];

    const query = searchText ? String(searchText).trim().toLowerCase() : '';
    if (!query) {
      return [...queries].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    return queries.filter(item => {
      if (!item) return false;
      const matchName = item.name && item.name.toLowerCase().includes(query);
      const matchDesc = item.description && item.description.toLowerCase().includes(query);
      const matchSql = item.sql && item.sql.toLowerCase().includes(query);
      return Boolean(matchName || matchDesc || matchSql);
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return {
    MAX_SAVED_QUERIES,
    MAX_SQL_LENGTH,
    MAX_NAME_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    STORAGE_KEY_PREFIX,
    getSqlSavedQueriesStorageKey,
    buildSqlSavedQueryEntry,
    loadSqlSavedQueries,
    saveSqlSavedQueries,
    createSqlSavedQuery,
    updateSqlSavedQuery,
    deleteSqlSavedQuery,
    filterSqlSavedQueries
  };
}));
