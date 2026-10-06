/**
 * DashboardRepository.ts
 *
 * Data-access functions for dashboard aggregation queries.
 * Every function accepts a sql.js {@link Database} instance as its first
 * argument so that callers control the database lifecycle and can inject
 * an in-memory instance during testing.
 *
 * All spending queries filter to non-deleted expense transactions
 * (IsDeleted = 0, IsIncome = 0).
 */

import type { Database } from "sql.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Spending grouped by tag. */
export interface SpendingByTag {
  tagName: string;
  total: number;
  count: number;
}

/** Spending grouped by calendar month. */
export interface SpendingByMonth {
  month: string; // "YYYY-MM" format
  total: number;
  count: number;
}

/** Spending grouped by ISO week. */
export interface SpendingByWeek {
  week: string; // "YYYY-WW" format
  total: number;
  count: number;
}

/** Spending grouped by vendor (NotificationTitle). */
export interface SpendingByVendor {
  vendor: string;
  total: number;
  count: number;
}

/** Overall spending summary. */
export interface SpendingSummary {
  total: number;
  count: number;
  avgPerTransaction: number;
}

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

/** Base WHERE clause shared by all spending queries. */
const EXPENSE_FILTER = "t.IsDeleted = 0 AND t.IsIncome = 0 AND t.Amount IS NOT NULL";

// ---------------------------------------------------------------------------
// Date-range helpers
// ---------------------------------------------------------------------------

interface DateRangeClause {
  sql: string;
  params: (string | number | null)[];
}

function buildDateRangeClause(
  startDate?: string,
  endDate?: string
): DateRangeClause {
  const fragments: string[] = [];
  const params: (string | number | null)[] = [];

  if (startDate !== undefined) {
    fragments.push("t.ReceivedAt >= ?");
    params.push(startDate);
  }
  if (endDate !== undefined) {
    fragments.push("t.ReceivedAt <= ?");
    params.push(endDate);
  }

  return {
    sql: fragments.length > 0 ? " AND " + fragments.join(" AND ") : "",
    params,
  };
}

// ---------------------------------------------------------------------------
// Tag-filter helper
// ---------------------------------------------------------------------------

interface TagFilterClause {
  whereSql: string;
  params: number[];
}

function buildTagFilterClause(tagIds?: number[]): TagFilterClause {
  if (!tagIds || tagIds.length === 0) return { whereSql: "", params: [] };
  const placeholders = tagIds.map(() => "?").join(",");
  return {
    whereSql: ` AND EXISTS (SELECT 1 FROM TransactionTags WHERE TransactionId = t.Id AND TagId IN (${placeholders}))`,
    params: [...tagIds],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns spending grouped by tag name, ordered by total descending.
 * Includes an "Untagged" entry for expense transactions that have no tags.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getSpendingByTag(
  db: Database,
  startDate?: string,
  endDate?: string,
  tagIds?: number[]
): SpendingByTag[] {
  const dateRange = buildDateRangeClause(startDate, endDate);
  const tagFilter = buildTagFilterClause(tagIds);

  // When tag filter is active, restrict GROUP BY to only the selected tags
  // to avoid showing extra categories from multi-tagged transactions.
  const tagJoinFilter = tagIds && tagIds.length > 0
    ? ` AND tg.Id IN (${tagIds.map(() => "?").join(",")})`
    : "";
  const tagJoinParams = tagIds && tagIds.length > 0 ? [...tagIds] : [];

  // Tagged transactions grouped by tag name
  const taggedRows = queryRows<{ tagName: string; total: number; count: number }>(
    db,
    `SELECT tg.Name AS tagName,
            SUM(t.Amount) AS total,
            COUNT(DISTINCT t.Id) AS count
     FROM Transactions t
     JOIN TransactionTags tt ON tt.TransactionId = t.Id
     JOIN Tags tg ON tg.Id = tt.TagId${tagJoinFilter}
     WHERE ${EXPENSE_FILTER}${dateRange.sql}${tagFilter.whereSql}
     GROUP BY tg.Name
     ORDER BY total DESC`,
    [...tagJoinParams, ...dateRange.params, ...tagFilter.params]
  );

  // Untagged transactions
  const untaggedRows = queryRows<{ total: number; count: number }>(
    db,
    `SELECT SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     LEFT JOIN TransactionTags tt ON tt.TransactionId = t.Id
     WHERE ${EXPENSE_FILTER} AND tt.Id IS NULL${dateRange.sql}`,
    dateRange.params
  );

  const results: SpendingByTag[] = taggedRows.map((row) => ({
    tagName: row.tagName,
    total: row.total,
    count: row.count,
  }));

  // Only show Untagged when no tag filter is active
  if (!tagIds || tagIds.length === 0) {
    const untagged = untaggedRows[0];
    if (untagged && untagged.count > 0) {
      results.push({
        tagName: "Untagged",
        total: untagged.total,
        count: untagged.count,
      });
    }
  }

  return results;
}

/**
 * Returns spending grouped by calendar month, ordered chronologically.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Inclusive lower bound for ReceivedAt (ISO date string).
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getSpendingByMonth(
  db: Database,
  startDate: string,
  endDate?: string,
  tagIds?: number[]
): SpendingByMonth[] {
  const tagFilter = buildTagFilterClause(tagIds);
  const endClause = endDate !== undefined ? " AND t.ReceivedAt <= ?" : "";
  const endParams = endDate !== undefined ? [endDate] : [];
  return queryRows<SpendingByMonth>(
    db,
    `SELECT strftime('%Y-%m', t.ReceivedAt) AS month,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}
       AND t.ReceivedAt >= ?${endClause}${tagFilter.whereSql}
     GROUP BY strftime('%Y-%m', t.ReceivedAt)
     ORDER BY month ASC`,
    [startDate, ...endParams, ...tagFilter.params]
  );
}

/**
 * Returns spending grouped by vendor (NotificationTitle), ordered by total
 * descending.
 *
 * @param db - sql.js Database instance.
 * @param limit - Maximum number of vendors to return (default 10).
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getSpendingByVendor(
  db: Database,
  limit: number = 10,
  startDate?: string,
  endDate?: string,
  tagIds?: number[]
): SpendingByVendor[] {
  const dateRange = buildDateRangeClause(startDate, endDate);
  const tagFilter = buildTagFilterClause(tagIds);

  return queryRows<SpendingByVendor>(
    db,
    `SELECT COALESCE(t.NotificationTitle, 'Unknown') AS vendor,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}${dateRange.sql}${tagFilter.whereSql}
     GROUP BY t.NotificationTitle
     ORDER BY total DESC
     LIMIT ?`,
    [...dateRange.params, ...tagFilter.params, limit]
  );
}

/**
 * Returns an overall spending summary (total, count, average per transaction).
 *
 * @param db - sql.js Database instance.
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getSpendingSummary(
  db: Database,
  startDate?: string,
  endDate?: string,
  tagIds?: number[]
): SpendingSummary {
  const dateRange = buildDateRangeClause(startDate, endDate);
  const tagFilter = buildTagFilterClause(tagIds);

  const rows = queryRows<{ total: number | null; count: number }>(
    db,
    `SELECT SUM(t.Amount)  AS total,
            COUNT(t.Id)    AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}${dateRange.sql}${tagFilter.whereSql}`,
    [...dateRange.params, ...tagFilter.params]
  );

  const row = rows[0];
  const total = row?.total ?? 0;
  const count = row?.count ?? 0;
  const avgPerTransaction = count > 0 ? total / count : 0;

  return { total, count, avgPerTransaction };
}

/**
 * Returns an income summary (total and count of income transactions).
 *
 * @param db - sql.js Database instance.
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getIncomeSummary(
  db: Database,
  startDate?: string,
  endDate?: string,
  tagIds?: number[]
): { total: number; count: number } {
  const dateRange = buildDateRangeClause(startDate, endDate);
  const tagFilter = buildTagFilterClause(tagIds);
  const rows = queryRows<{ total: number | null; count: number }>(
    db,
    `SELECT SUM(t.Amount) AS total, COUNT(t.Id) AS count
     FROM Transactions t
     WHERE t.IsDeleted = 0 AND t.IsIncome = 1 AND t.Amount IS NOT NULL${dateRange.sql}${tagFilter.whereSql}`,
    [...dateRange.params, ...tagFilter.params]
  );
  const row = rows[0];
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/**
 * Returns income grouped by calendar month, ordered chronologically.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Inclusive lower bound for ReceivedAt (ISO date string).
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getIncomeByMonth(
  db: Database,
  startDate: string,
  endDate?: string,
  tagIds?: number[]
): SpendingByMonth[] {
  const tagFilter = buildTagFilterClause(tagIds);
  const endClause = endDate !== undefined ? " AND t.ReceivedAt <= ?" : "";
  const endParams = endDate !== undefined ? [endDate] : [];
  return queryRows<SpendingByMonth>(
    db,
    `SELECT strftime('%Y-%m', t.ReceivedAt) AS month,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE t.IsDeleted = 0 AND t.IsIncome = 1 AND t.Amount IS NOT NULL
       AND t.ReceivedAt >= ?${endClause}${tagFilter.whereSql}
     GROUP BY strftime('%Y-%m', t.ReceivedAt)
     ORDER BY month ASC`,
    [startDate, ...endParams, ...tagFilter.params]
  );
}

/**
 * Returns the number of non-deleted expense transactions that have zero tags.
 *
 * @param db - sql.js Database instance.
 */
export function getUntaggedTransactionCount(db: Database): number {
  const rows = queryRows<{ cnt: number }>(
    db,
    `SELECT COUNT(*) AS cnt
     FROM Transactions t
     LEFT JOIN TransactionTags tt ON tt.TransactionId = t.Id
     WHERE t.IsDeleted = 0 AND t.IsIncome = 0 AND tt.Id IS NULL`
  );
  return rows[0]?.cnt ?? 0;
}

/**
 * Returns expense spending grouped by ISO week (strftime '%W'), ordered
 * chronologically.  Used for the weekly trend chart within a single month.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Inclusive lower bound for ReceivedAt (ISO date string).
 * @param endDate - Inclusive upper bound for ReceivedAt (ISO date string).
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getSpendingByWeek(
  db: Database,
  startDate: string,
  endDate: string,
  tagIds?: number[]
): SpendingByWeek[] {
  const tagFilter = buildTagFilterClause(tagIds);
  return queryRows<SpendingByWeek>(
    db,
    `SELECT strftime('%Y-%W', t.ReceivedAt) AS week,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}
       AND t.ReceivedAt >= ?
       AND t.ReceivedAt <= ?${tagFilter.whereSql}
     GROUP BY strftime('%Y-%W', t.ReceivedAt)
     ORDER BY week ASC`,
    [startDate, endDate, ...tagFilter.params]
  );
}

/**
 * Returns income grouped by ISO week, ordered chronologically.
 * Used for the weekly trend chart within a single month.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Inclusive lower bound for ReceivedAt (ISO date string).
 * @param endDate - Inclusive upper bound for ReceivedAt (ISO date string).
 * @param tagIds - Optional tag IDs to restrict results to.
 */
export function getIncomeByWeek(
  db: Database,
  startDate: string,
  endDate: string,
  tagIds?: number[]
): SpendingByWeek[] {
  const tagFilter = buildTagFilterClause(tagIds);
  return queryRows<SpendingByWeek>(
    db,
    `SELECT strftime('%Y-%W', t.ReceivedAt) AS week,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE t.IsDeleted = 0 AND t.IsIncome = 1 AND t.Amount IS NOT NULL
       AND t.ReceivedAt >= ?
       AND t.ReceivedAt <= ?${tagFilter.whereSql}
     GROUP BY strftime('%Y-%W', t.ReceivedAt)
     ORDER BY week ASC`,
    [startDate, endDate, ...tagFilter.params]
  );
}
