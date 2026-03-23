/**
 * TagRepository.ts
 *
 * Data-access functions for the Tags and TransactionTags tables.
 * Every function accepts a sql.js {@link Database} instance as its first
 * argument so that callers control the database lifecycle and can inject
 * an in-memory instance during testing.
 */

import type { Database } from "sql.js";
import type { Tag } from "../models/Tag";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Executes a SELECT query and returns rows as plain objects.
 *
 * @param db - sql.js Database instance.
 * @param sql - SQL statement string.
 * @param params - Positional bind parameters.
 */
function queryRows<T>(
  db: Database,
  sql: string,
  params: (string | number | null)[] = []
): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

/** Raw row shape returned by Tag SELECT queries. */
interface TagRow {
  Id: number;
  Name: string;
  LastUsedAt: string;
}

/**
 * Maps a raw database row to a {@link Tag} domain object.
 *
 * @param row - Raw row from the Tags table.
 * @returns A fully-initialised Tag (transactionTags is always empty here).
 */
function rowToTag(row: TagRow): Tag {
  return {
    id: row.Id,
    name: row.Name,
    lastUsedAt: row.LastUsedAt,
    transactionTags: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the existing tag with the given name, or creates and returns a new
 * one if no match exists (idempotent).
 *
 * @param db - sql.js Database instance.
 * @param name - Tag name to find or create.
 * @returns The existing or newly-created {@link Tag}.
 */
export function addTag(db: Database, name: string): Tag {
  // Return existing tag if one already exists with this name.
  const existing = queryRows<TagRow>(
    db,
    "SELECT Id, Name, LastUsedAt FROM Tags WHERE Name = ? LIMIT 1",
    [name]
  );
  const existingRow = existing[0];
  if (existingRow) {
    return rowToTag(existingRow);
  }

  const now = new Date().toISOString();
  db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [name, now]);

  const idRows = queryRows<{ id: number }>(
    db,
    "SELECT last_insert_rowid() AS id"
  );
  const newId = idRows[0]?.id;
  if (newId === undefined) {
    throw new Error("Failed to resolve inserted tag id.");
  }

  return {
    id: newId,
    name,
    lastUsedAt: now,
    transactionTags: [],
  };
}

/**
 * Searches tags whose name contains the query string (case-insensitive LIKE).
 * Returns an empty array when the query is shorter than 2 characters.
 * Results are ordered by usage count (number of linked transactions) descending
 * and capped at 10.
 *
 * @param db - sql.js Database instance.
 * @param query - Substring to search for; must be at least 2 characters.
 * @returns Up to 10 matching {@link Tag} objects.
 */
export function searchTags(db: Database, query: string): Tag[] {
  if (query.length < 2) {
    return [];
  }

  // Escape LIKE wildcards so user input with % or _ is treated literally.
  const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const rows = queryRows<TagRow>(
    db,
    `SELECT t.Id, t.Name, t.LastUsedAt
     FROM Tags t
     LEFT JOIN TransactionTags tt ON tt.TagId = t.Id
     WHERE t.Name LIKE ? ESCAPE '\\'
     GROUP BY t.Id, t.Name, t.LastUsedAt
     ORDER BY COUNT(tt.Id) DESC
     LIMIT 10`,
    [`%${escaped}%`]
  );

  return rows.map(rowToTag);
}

/**
 * Returns the top-N tags ordered by the number of linked transactions
 * (most used first).
 *
 * @param db - sql.js Database instance.
 * @param limit - Maximum number of tags to return.
 * @returns Up to `limit` {@link Tag} objects.
 */
export function getMostCommonTags(db: Database, limit: number): Tag[] {
  const rows = queryRows<TagRow>(
    db,
    `SELECT t.Id, t.Name, t.LastUsedAt
     FROM Tags t
     LEFT JOIN TransactionTags tt ON tt.TagId = t.Id
     GROUP BY t.Id, t.Name, t.LastUsedAt
     ORDER BY COUNT(tt.Id) DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map(rowToTag);
}

/**
 * Returns all tags sorted by `lastUsedAt` descending (most recently used
 * first).
 *
 * @param db - sql.js Database instance.
 * @returns All {@link Tag} objects ordered by recency.
 */
export function getTagsOrderedByLastUsed(db: Database): Tag[] {
  const rows = queryRows<TagRow>(
    db,
    "SELECT Id, Name, LastUsedAt FROM Tags ORDER BY LastUsedAt DESC"
  );
  return rows.map(rowToTag);
}

/**
 * Creates a link between a transaction and a tag.
 *
 * - If the link already exists the unique index causes the INSERT to fail
 *   silently (`INSERT OR IGNORE`), so no error is thrown on duplicates.
 * - Updates `Tag.lastUsedAt` to the current UTC timestamp.
 *
 * @param db - sql.js Database instance.
 * @param transactionId - Primary key of the transaction.
 * @param tagId - Primary key of the tag.
 */
export function addTagToTransaction(
  db: Database,
  transactionId: number,
  tagId: number
): void {
  const currentRows = queryRows<{ lastUsedAt: string }>(
    db,
    "SELECT LastUsedAt AS lastUsedAt FROM Tags WHERE Id = ?",
    [tagId]
  );
  const currentLastUsedAt = currentRows[0]?.lastUsedAt;
  const now = new Date().toISOString();
  const effectiveTimestamp =
    currentLastUsedAt && currentLastUsedAt >= now
      ? new Date(new Date(currentLastUsedAt).getTime() + 1).toISOString()
      : now;

  db.run(
    `INSERT OR IGNORE INTO TransactionTags (TransactionId, TagId, CreatedAt)
     VALUES (?, ?, ?)`,
    [transactionId, tagId, effectiveTimestamp]
  );

  db.run("UPDATE Tags SET LastUsedAt = ? WHERE Id = ?", [
    effectiveTimestamp,
    tagId,
  ]);
}

/**
 * Returns all tags linked to the given transaction.
 *
 * @param db - sql.js Database instance.
 * @param transactionId - Primary key of the transaction.
 * @returns All {@link Tag} objects linked to the transaction.
 */
export function getTagsForTransaction(db: Database, transactionId: number): Tag[] {
  const rows = queryRows<TagRow>(
    db,
    `SELECT t.Id, t.Name, t.LastUsedAt
     FROM Tags t
     JOIN TransactionTags tt ON tt.TagId = t.Id
     WHERE tt.TransactionId = ?`,
    [transactionId]
  );
  return rows.map(rowToTag);
}

/**
 * Removes the link between a transaction and a tag.
 *
 * @param db - sql.js Database instance.
 * @param transactionId - Primary key of the transaction.
 * @param tagId - Primary key of the tag.
 */
export function removeTagFromTransaction(
  db: Database,
  transactionId: number,
  tagId: number
): void {
  db.run(
    "DELETE FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
    [transactionId, tagId]
  );
}
