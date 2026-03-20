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
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns spending grouped by tag name, ordered by total descending.
 * Includes an "Untagged" entry for expense transactions that have no tags.
 *
 * @param db - sql.js Database instance.
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 */
export function getSpendingByTag(
  db: Database,
  startDate?: string,
  endDate?: string
): SpendingByTag[] {
  const dateRange = buildDateRangeClause(startDate, endDate);

  // Tagged transactions grouped by tag name
  const taggedRows = queryRows<{ tagName: string; total: number; count: number }>(
    db,
    `SELECT tg.Name AS tagName,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     JOIN TransactionTags tt ON tt.TransactionId = t.Id
     JOIN Tags tg ON tg.Id = tt.TagId
     WHERE ${EXPENSE_FILTER}${dateRange.sql}
     GROUP BY tg.Name
     ORDER BY total DESC`,
    dateRange.params
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

  const untagged = untaggedRows[0];
  if (untagged && untagged.count > 0) {
    results.push({
      tagName: "Untagged",
      total: untagged.total,
      count: untagged.count,
    });
  }

  return results;
}

/**
 * Returns spending grouped by calendar month, ordered chronologically.
 *
 * @param db - sql.js Database instance.
 * @param months - Number of most-recent months to include (default 6).
 */
export function getSpendingByMonth(
  db: Database,
  months: number = 6
): SpendingByMonth[] {
  return queryRows<SpendingByMonth>(
    db,
    `SELECT strftime('%Y-%m', t.ReceivedAt) AS month,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}
       AND t.ReceivedAt >= date('now', '-' || ? || ' months')
     GROUP BY strftime('%Y-%m', t.ReceivedAt)
     ORDER BY month ASC`,
    [months]
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
 */
export function getSpendingByVendor(
  db: Database,
  limit: number = 10,
  startDate?: string,
  endDate?: string
): SpendingByVendor[] {
  const dateRange = buildDateRangeClause(startDate, endDate);

  return queryRows<SpendingByVendor>(
    db,
    `SELECT COALESCE(t.NotificationTitle, 'Unknown') AS vendor,
            SUM(t.Amount) AS total,
            COUNT(t.Id)   AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}${dateRange.sql}
     GROUP BY t.NotificationTitle
     ORDER BY total DESC
     LIMIT ?`,
    [...dateRange.params, limit]
  );
}

/**
 * Returns an overall spending summary (total, count, average per transaction).
 *
 * @param db - sql.js Database instance.
 * @param startDate - Optional inclusive lower bound for ReceivedAt.
 * @param endDate - Optional inclusive upper bound for ReceivedAt.
 */
export function getSpendingSummary(
  db: Database,
  startDate?: string,
  endDate?: string
): SpendingSummary {
  const dateRange = buildDateRangeClause(startDate, endDate);

  const rows = queryRows<{ total: number | null; count: number }>(
    db,
    `SELECT SUM(t.Amount)  AS total,
            COUNT(t.Id)    AS count
     FROM Transactions t
     WHERE ${EXPENSE_FILTER}${dateRange.sql}`,
    dateRange.params
  );

  const row = rows[0];
  const total = row?.total ?? 0;
  const count = row?.count ?? 0;
  const avgPerTransaction = count > 0 ? total / count : 0;

  return { total, count, avgPerTransaction };
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
