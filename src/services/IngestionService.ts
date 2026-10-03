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
 *    most recent previous transaction that shares the same title **and**
 *    number-stripped body (prefer), falling back to title-only when no
 *    stripped-body match exists, so same-recipient recurring transfers
 *    (`Átutalás elküldve … Kovács Jánosnak`) inherit tags regardless of the
 *    amount, while transfers to different recipients classify independently.
 * 4. **Manual-transaction auto-tag** – transactions created via
 *    `addManualTransaction` in `useTransactions` always receive the
 *    "AddedManually" tag (handled at the call-site in that hook).
 */

import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";

import {
  addTransaction,
  existsDuplicateWithinSeconds,
  findSoftDeletedMatch,
  findLastTransactionByTitle,
  findLastTransactionByTitleAndBody,
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
 *    most recent previous transaction that matches on title + stripped body
 *    (prefer), falling back to the title-only match when no stripped-body
 *    match is found (so previously title-tagged transactions keep classifying).
 *
 * @param db          - sql.js Database instance (caller controls lifecycle).
 * @param txData      - The transaction to insert (id is not required).
 * @returns The persisted {@link Transaction} (possibly soft-deleted), or
 *          `null` when the notification was a duplicate and was skipped.
 */
export function ingestNotification(
  db: Database,
  txData: Omit<Transaction, "id" | "parsedAmount" | "parsedCurrency" | "transactionTags">,
  duplicateWindowSeconds = 5
): Transaction | null {
  // -------------------------------------------------------------------------
  // 1. Deduplication guard
  // -------------------------------------------------------------------------
  if (
    existsDuplicateWithinSeconds(
      db,
      txData.notificationTitle,
      txData.notificationBody,
      txData.packageName,
      txData.receivedAt,
      duplicateWindowSeconds
    )
  ) {
    return null;
  }

  // -------------------------------------------------------------------------
  // 2. Snapshot the previous same-title transaction BEFORE inserting, so the
  //    new row does not shadow it in the auto-tag lookup.
  //
  //    We capture TWO candidates:
  //      a) previousByTitleAndBody – most recent match on title AND
  //         number-stripped body (preferred for tag propagation in step 5).
  //      b) previousByTitle        – most recent match on title only
  //         (fallback when no stripped-body match exists, preserving
  //         backwards compatibility for previously title-tagged txns).
  // -------------------------------------------------------------------------
  const previousByTitleAndBody = findLastTransactionByTitleAndBody(
    db,
    txData.notificationTitle,
    txData.notificationBody
  );
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
  // 5. Auto-tag by vendor – copy qualifying tags from the best previous
  //    transaction for this vendor (excluding "AddedManually").
  //
  //    PREFER the title+stripped-body match so that same-recipient recurring
  //    transfers (same title, different amounts) inherit tags from the most
  //    recent transfer to the SAME recipient.
  //
  //    FALL BACK to the title-only match ONLY when the incoming body is null
  //    (no body information means we cannot distinguish by content, so title
  //    alone is the best available signal). When the incoming body is non-null
  //    but no stripped-body match exists, the transaction is new to this
  //    recipient/pattern and should NOT inherit from a different one.
  // -------------------------------------------------------------------------
  const previous =
    previousByTitleAndBody ??
    (txData.notificationBody === null ? previousByTitle : null);
  if (previous !== null) {
    const tagsToPropagate = previous.transactionTags.filter(
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
