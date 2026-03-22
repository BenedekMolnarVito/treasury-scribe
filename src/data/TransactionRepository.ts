/**
 * TransactionRepository.ts
 *
 * Data-access functions for the Transactions table.
 * Every function accepts a sql.js {@link Database} instance as its first
 * argument so that callers control the database lifecycle and can inject
 * an in-memory instance during testing.
 *
 * Tags are eagerly loaded via a LEFT JOIN on the TransactionTags and Tags
 * tables wherever the specification requires them.
 */

import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";
import type { TransactionTag } from "../models/TransactionTag";
import { withComputedProps } from "../models/Transaction";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Represents one row returned by the JOIN query.
 * A single transaction may appear on multiple rows when it has more than one
 * tag; we collapse them in {@link groupTransactionRows}.
 */
interface TransactionRow {
  Id: number;
  RawContent: string | null;
  JsonContent: string | null;
  ReceivedAt: string;
  NotificationTitle: string | null;
  NotificationBody: string | null;
  PackageName: string | null;
  IsDeleted: number;
  IsCash: number;
  Amount: number | null;
  Currency: string | null;
  IsIncome: number;
  // From TransactionTags JOIN
  TtId: number | null;
  TagId: number | null;
  TtCreatedAt: string | null;
  /** Eagerly loaded tag name from the Tags table. */
  TagName: string | null;
}

/**
 * Collapses an array of (potentially duplicated) JOIN rows into a de-duped
 * list of {@link Transaction} objects, with `transactionTags` populated.
 *
 * @param rows - Raw rows from the LEFT JOIN query.
 * @returns De-duplicated transactions ordered as returned by the query.
 */
function groupTransactionRows(rows: TransactionRow[]): Transaction[] {
  const map = new Map<number, Transaction>();
  const order: number[] = [];

  for (const row of rows) {
    if (!map.has(row.Id)) {
      const tx: Transaction = withComputedProps({
        id: row.Id,
        rawContent: row.RawContent,
        jsonContent: row.JsonContent,
        receivedAt: row.ReceivedAt,
        notificationTitle: row.NotificationTitle,
        notificationBody: row.NotificationBody,
        packageName: row.PackageName,
        isDeleted: row.IsDeleted === 1,
        isCash: row.IsCash === 1,
        amount: row.Amount,
        currency: row.Currency,
        isIncome: row.IsIncome === 1,
        transactionTags: [],
        // Placeholders – overwritten by withComputedProps
        parsedAmount: null,
        parsedCurrency: null,
      });
      map.set(row.Id, tx);
      order.push(row.Id);
    }

    if (row.TtId !== null && row.TagId !== null) {
      const tag: TransactionTag = {
        id: row.TtId,
        transactionId: row.Id,
        tagId: row.TagId,
        createdAt: row.TtCreatedAt ?? "",
      };
      if (row.TagName !== null) {
        tag.tagName = row.TagName;
      }
      map.get(row.Id)!.transactionTags.push(tag);
    }
  }

  return order.map((id) => map.get(id)!);
}

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

// ---------------------------------------------------------------------------
// Base SELECT with LEFT JOIN for eager-loading tags
// ---------------------------------------------------------------------------

const SELECT_WITH_TAGS = `
  SELECT
    t.Id,
    t.RawContent,
    t.JsonContent,
    t.ReceivedAt,
    t.NotificationTitle,
    t.NotificationBody,
    t.PackageName,
    t.IsDeleted,
    t.IsCash,
    t.Amount,
    t.Currency,
    t.IsIncome,
    tt.Id       AS TtId,
    tt.TagId    AS TagId,
    tt.CreatedAt AS TtCreatedAt,
    tg.Name     AS TagName
  FROM Transactions t
  LEFT JOIN TransactionTags tt ON tt.TransactionId = t.Id
  LEFT JOIN Tags tg ON tg.Id = tt.TagId
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all non-deleted transactions ordered by `receivedAt` DESC with
 * their tags eagerly loaded.
 *
 * @param db - sql.js Database instance.
 */
export function getAllTransactions(db: Database): Transaction[] {
  const sql = `${SELECT_WITH_TAGS} WHERE t.IsDeleted = 0 ORDER BY t.ReceivedAt DESC`;
  const rows = queryRows<TransactionRow>(db, sql);
  return groupTransactionRows(rows);
}

/**
 * Returns all transactions (including soft-deleted) ordered by `receivedAt`
 * DESC with their tags eagerly loaded.
 *
 * @param db - sql.js Database instance.
 */
export function getAllTransactionsIncludingDeleted(db: Database): Transaction[] {
  const sql = `${SELECT_WITH_TAGS} ORDER BY t.ReceivedAt DESC`;
  const rows = queryRows<TransactionRow>(db, sql);
  return groupTransactionRows(rows);
}

/**
 * Returns a single transaction (with tags) by its primary key, or `null` if
 * not found.
 *
 * @param db - sql.js Database instance.
 * @param id - Primary key of the transaction.
 */
export function getTransactionById(
  db: Database,
  id: number
): Transaction | null {
  const sql = `${SELECT_WITH_TAGS} WHERE t.Id = ?`;
  const rows = queryRows<TransactionRow>(db, sql, [id]);
  const results = groupTransactionRows(rows);
  return results[0] ?? null;
}

/**
 * Inserts a new transaction row and returns the inserted entity (with the
 * database-assigned `id`).
 *
 * @param db - sql.js Database instance.
 * @param transaction - Transaction data to insert (id is ignored / omitted).
 */
export function addTransaction(
  db: Database,
  transaction: Omit<Transaction, "id" | "parsedAmount" | "parsedCurrency" | "transactionTags">
): Transaction {
  db.run(
    `INSERT INTO Transactions
      (RawContent, JsonContent, ReceivedAt, NotificationTitle, NotificationBody,
       PackageName, IsDeleted, IsCash, Amount, Currency, IsIncome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transaction.rawContent,
      transaction.jsonContent,
      transaction.receivedAt,
      transaction.notificationTitle,
      transaction.notificationBody,
      transaction.packageName,
      transaction.isDeleted ? 1 : 0,
      transaction.isCash ? 1 : 0,
      transaction.amount,
      transaction.currency,
      transaction.isIncome ? 1 : 0,
    ] as Parameters<typeof db.run>[1]
  );

  const idRow = queryRows<{ id: number }>(db, "SELECT last_insert_rowid() AS id");
  const newId = idRow[0]?.id;
  if (newId === undefined) {
    throw new Error("Failed to resolve inserted transaction id.");
  }

  return getTransactionById(db, newId)!;
}

/**
 * Updates the columns of the transaction identified by `transaction.id`.
 * Only the persisted scalar columns are updated; `transactionTags` is managed
 * separately via the TagRepository.
 *
 * @param db - sql.js Database instance.
 * @param transaction - Full transaction object with updated values.
 */
export function updateTransaction(
  db: Database,
  transaction: Pick<
    Transaction,
    | "id"
    | "rawContent"
    | "jsonContent"
    | "receivedAt"
    | "notificationTitle"
    | "notificationBody"
    | "packageName"
    | "isDeleted"
    | "isCash"
    | "amount"
    | "currency"
    | "isIncome"
  >
): void {
  db.run(
    `UPDATE Transactions SET
      RawContent        = ?,
      JsonContent       = ?,
      ReceivedAt        = ?,
      NotificationTitle = ?,
      NotificationBody  = ?,
      PackageName       = ?,
      IsDeleted         = ?,
      IsCash            = ?,
      Amount            = ?,
      Currency          = ?,
      IsIncome          = ?
     WHERE Id = ?`,
    [
      transaction.rawContent,
      transaction.jsonContent,
      transaction.receivedAt,
      transaction.notificationTitle,
      transaction.notificationBody,
      transaction.packageName,
      transaction.isDeleted ? 1 : 0,
      transaction.isCash ? 1 : 0,
      transaction.amount,
      transaction.currency,
      transaction.isIncome ? 1 : 0,
      transaction.id,
    ] as Parameters<typeof db.run>[1]
  );
}

/**
 * Hard-deletes a transaction row (and its TransactionTag rows via CASCADE).
 * Intended for test teardown and administrative purposes only.
 *
 * @param db - sql.js Database instance.
 * @param id - Primary key of the transaction to remove.
 */
export function deleteTransaction(db: Database, id: number): void {
  db.run("DELETE FROM Transactions WHERE Id = ?", [id]);
}

/**
 * Soft-deletes a single transaction by setting `IsDeleted = 1`.
 *
 * @param db - sql.js Database instance.
 * @param id - Primary key of the transaction to soft-delete.
 */
export function softDeleteTransaction(db: Database, id: number): void {
  db.run("UPDATE Transactions SET IsDeleted = 1 WHERE Id = ?", [id]);
}

/**
 * Soft-deletes **all** transactions by setting `IsDeleted = 1` on every row.
 *
 * @param db - sql.js Database instance.
 */
export function softDeleteAllTransactions(db: Database): void {
  db.run("UPDATE Transactions SET IsDeleted = 1");
}

/**
 * Checks whether a duplicate transaction exists within a caller-supplied
 * ±N-second window.
 */
export function existsDuplicateWithinSeconds(
  db: Database,
  title: string | null,
  body: string | null,
  packageName: string | null,
  receivedAt: string,
  windowSeconds: number
): boolean {
  const rows = queryRows<{ cnt: number }>(
    db,
    `SELECT COUNT(*) AS cnt
     FROM Transactions
     WHERE NotificationTitle IS ?
       AND NotificationBody  IS ?
       AND PackageName       IS ?
       AND ABS(
             (julianday(ReceivedAt) - julianday(?)) * 86400.0
           ) <= ?`,
    [title, body, packageName, receivedAt, windowSeconds + 0.0001]
  );
  return (rows[0]?.cnt ?? 0) > 0;
}

/**
 * Checks whether a duplicate transaction exists within a ±5-second window.
 *
 * A duplicate is defined as a transaction with the same `notificationTitle`,
 * `notificationBody`, and `packageName` whose `receivedAt` is within 5
 * seconds of the supplied timestamp.
 *
 * @param db - sql.js Database instance.
 * @param title - Notification title to match.
 * @param body - Notification body to match.
 * @param packageName - Package name to match.
 * @param receivedAt - ISO 8601 reference timestamp.
 * @returns `true` if at least one duplicate exists.
 */
export function existsDuplicate(
  db: Database,
  title: string | null,
  body: string | null,
  packageName: string | null,
  receivedAt: string
): boolean {
  return existsDuplicateWithinSeconds(
    db,
    title,
    body,
    packageName,
    receivedAt,
    5
  );
}

/**
 * Finds a soft-deleted transaction that matches the given title and body.
 * Returns the first match or `null` if none exists.
 *
 * @param db - sql.js Database instance.
 * @param title - Notification title to match.
 * @param body - Notification body to match.
 */
export function findSoftDeletedMatch(
  db: Database,
  title: string | null,
  body: string | null
): Transaction | null {
  // LIMIT on a JOIN may return multiple rows for the same transaction when it
  // has multiple tags. Use a subquery approach to get only the most recent id.
  const idRows = queryRows<{ Id: number }>(
    db,
    `SELECT Id FROM Transactions
     WHERE IsDeleted = 1
       AND NotificationTitle IS ?
       AND NotificationBody  IS ?
     ORDER BY ReceivedAt DESC
     LIMIT 1`,
    [title, body]
  );
  if (idRows.length === 0) return null;
  const matchId = idRows[0]?.Id;
  if (matchId === undefined) return null;
  return getTransactionById(db, matchId);
}

/**
 * Returns the most recent non-deleted transaction with the given
 * `notificationTitle`, with tags eagerly loaded.
 *
 * @param db - sql.js Database instance.
 * @param title - The notification title to search for.
 * @returns The most recent matching transaction or `null` if none exists.
 */
export function findLastTransactionByTitle(
  db: Database,
  title: string | null
): Transaction | null {
  const idRows = queryRows<{ Id: number }>(
    db,
    `SELECT Id FROM Transactions
     WHERE IsDeleted = 0
       AND NotificationTitle IS ?
     ORDER BY ReceivedAt DESC
     LIMIT 1`,
    [title]
  );
  if (idRows.length === 0) return null;
  const matchId = idRows[0]?.Id;
  if (matchId === undefined) return null;
  return getTransactionById(db, matchId);
}

// ---------------------------------------------------------------------------
// Tag filter queries
// ---------------------------------------------------------------------------

export interface TagWithCount {
  tagId: number;
  tagName: string;
  count: number;
}

/**
 * Returns all tags that are attached to at least one non-deleted transaction,
 * together with the count of non-deleted transactions for each tag.
 * Ordered by count DESC, then tagName ASC.
 */
export function getActiveTagsWithCounts(db: Database): TagWithCount[] {
  return queryRows<TagWithCount>(
    db,
    `SELECT tg.Id AS tagId, tg.Name AS tagName, COUNT(DISTINCT t.Id) AS count
     FROM Tags tg
     JOIN TransactionTags tt ON tt.TagId = tg.Id
     JOIN Transactions t ON t.Id = tt.TransactionId
     WHERE t.IsDeleted = 0
     GROUP BY tg.Id, tg.Name
     ORDER BY count DESC, tg.Name ASC`
  );
}

/**
 * Returns non-deleted transactions that match the given tag filter.
 *
 * @param tagIds - Tag IDs to include. When empty, all transactions are returned
 *   (subject to the `includeUntagged` flag).
 * @param includeUntagged - When true, transactions with no tags are included.
 */
export function getTransactionsByTagFilter(
  db: Database,
  tagIds: number[],
  includeUntagged: boolean
): Transaction[] {
  const conditions: string[] = ["t.IsDeleted = 0"];
  const params: (string | number | null)[] = [];
  const orClauses: string[] = [];

  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => "?").join(",");
    orClauses.push(
      `t.Id IN (SELECT TransactionId FROM TransactionTags WHERE TagId IN (${placeholders}))`
    );
    params.push(...tagIds);
  }

  if (includeUntagged) {
    orClauses.push(
      `t.Id NOT IN (SELECT TransactionId FROM TransactionTags)`
    );
  }

  if (orClauses.length > 0) {
    conditions.push(`(${orClauses.join(" OR ")})`);
  } else {
    // No tags selected, no untagged — return nothing
    return [];
  }

  const sql = `${SELECT_WITH_TAGS} WHERE ${conditions.join(" AND ")} ORDER BY t.ReceivedAt DESC`;
  const rows = queryRows<TransactionRow>(db, sql, params);
  return groupTransactionRows(rows);
}
