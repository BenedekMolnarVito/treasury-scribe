/**
 * IngestionService.ts
 *
 * Orchestrates the notification ingestion flow with four smart behaviours:
 *
 * 1. **Deduplication** – silently skips a notification when an identical one
 *    (same title + body + packageName within ±5 s) already exists.
 * 2. **Auto-soft-delete** – immediately soft-deletes the newly created
 *    transaction when a soft-deleted transaction with the same title + body
 *    exists, preserving the user's prior intent to dismiss it.
 * 3. **Auto-tag by vendor** – copies tags (excluding "AddedManually") from the
 *    most recent previous transaction that shares the same title, so recurring
 *    vendor transactions are tagged automatically.
 * 4. **Manual-transaction auto-tag** – transactions created via
 *    `addManualTransaction` in `useTransactions` always receive the
 *    "AddedManually" tag (handled at the call-site in that hook).
 */

import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";

import {
  addTransaction,
  existsDuplicate,
  findSoftDeletedMatch,
  findLastTransactionByTitle,
  getTransactionById,
  softDeleteTransaction,
} from "../data/TransactionRepository";

import { addTag, addTagToTransaction } from "../data/TagRepository";

/** Tag name excluded when propagating auto-tags from a previous transaction. */
const MANUAL_TAG = "AddedManually";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingests a notification into the database, applying all smart behaviours in
 * order.
 *
 * **Behaviour sequence**
 * 1. If a duplicate exists within ±5 s, returns `null` without persisting.
 * 2. Captures the most-recent same-title transaction **before** inserting, so
 *    that the new row is not accidentally returned as the "previous" one.
 * 3. Persists the new transaction via `addTransaction`.
 * 4. If a soft-deleted match (same title + body) exists, soft-deletes the
 *    newly created transaction.
 * 5. Copies qualifying tags (all tags except "AddedManually") from the
 *    previous same-title transaction to the new one.
 *
 * @param db          - sql.js Database instance (caller controls lifecycle).
 * @param txData      - The transaction to insert (id is not required).
 * @returns The persisted {@link Transaction} (possibly soft-deleted), or
 *          `null` when the notification was a duplicate and was skipped.
 */
export function ingestNotification(
  db: Database,
  txData: Omit<Transaction, "id" | "parsedAmount" | "parsedCurrency" | "transactionTags">
): Transaction | null {
  // -------------------------------------------------------------------------
  // 1. Deduplication guard
  // -------------------------------------------------------------------------
  if (
    existsDuplicate(
      db,
      txData.notificationTitle,
      txData.notificationBody,
      txData.packageName,
      txData.receivedAt
    )
  ) {
    return null;
  }

  // -------------------------------------------------------------------------
  // 2. Snapshot the previous same-title transaction BEFORE inserting, so the
  //    new row does not shadow it in the auto-tag lookup.
  // -------------------------------------------------------------------------
  const previousByTitle = findLastTransactionByTitle(db, txData.notificationTitle);

  // -------------------------------------------------------------------------
  // 3. Persist the new transaction
  // -------------------------------------------------------------------------
  const newTx = addTransaction(db, txData);

  // -------------------------------------------------------------------------
  // 4. Auto-soft-delete when a matching soft-deleted transaction exists
  // -------------------------------------------------------------------------
  const softDeletedMatch = findSoftDeletedMatch(
    db,
    txData.notificationTitle,
    txData.notificationBody
  );
  if (softDeletedMatch !== null) {
    softDeleteTransaction(db, newTx.id);
  }

  // -------------------------------------------------------------------------
  // 5. Auto-tag by vendor – copy qualifying tags from the previous same-title
  //    transaction (excluding "AddedManually")
  // -------------------------------------------------------------------------
  if (previousByTitle !== null) {
    const tagsToPropagate = previousByTitle.transactionTags.filter(
      (tt) => tt.tagName !== MANUAL_TAG
    );

    for (const tt of tagsToPropagate) {
      // Resolve tag by name so the tag row is created if it does not yet exist
      // in the target database (edge case in tests / migration).
      if (tt.tagName) {
        const tag = addTag(db, tt.tagName);
        addTagToTransaction(db, newTx.id, tag.id);
      }
    }
  }

  // Return the latest persisted state (reflects soft-delete flag and tags).
  return getTransactionById(db, newTx.id);
}
