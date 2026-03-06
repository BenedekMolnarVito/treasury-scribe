/**
 * useTransactions.ts
 *
 * React hook that manages the main transaction list screen state and actions.
 * Wraps TransactionRepository and TagRepository behind a clean stateful API.
 *
 * The optional `share` parameter allows callers (and tests) to inject a
 * custom share handler.  In production the default falls back to the
 * Capacitor Share plugin loaded via a dynamic import so that no hard
 * dependency on `@capacitor/share` is needed at module load time.
 */

import { useState, useCallback } from "react";
import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";
import type { Tag } from "../models/Tag";
import { createTransaction } from "../models/Transaction";

import {
  getAllTransactions,
  getAllTransactionsIncludingDeleted,
  addTransaction,
  softDeleteTransaction as repoSoftDelete,
  softDeleteAllTransactions as repoSoftDeleteAll,
  existsDuplicate,
} from "../data/TransactionRepository";

import {
  addTag,
  addTagToTransaction as repoAddTagToTx,
  removeTagFromTransaction as repoRemoveTagFromTx,
  searchTags as repoSearchTags,
} from "../data/TagRepository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal contract for the share abstraction.  Matches the Capacitor Share
 * plugin's `share()` method closely enough that no shim is required in
 * production.
 */
export type ShareFn = (title: string, text: string) => Promise<void>;

/**
 * Everything the hook exposes to the UI layer.
 */
export interface UseTransactionsResult {
  /** The currently-loaded list of transactions. */
  transactions: Transaction[];
  /** True while an async operation is in progress. */
  loading: boolean;
  /** When true, soft-deleted transactions are included in the list. */
  showDeleted: boolean;

  /** Toggle whether soft-deleted rows appear in the list. */
  setShowDeleted: (value: boolean) => void;
  /** (Re-)fetch transactions from the database. */
  loadTransactions: () => Promise<void>;
  /** Soft-delete one transaction by id and refresh the list. */
  softDeleteTransaction: (id: number) => Promise<void>;
  /** Soft-delete every transaction and refresh the list. */
  softDeleteAllTransactions: () => Promise<void>;
  /**
   * Create a manual transaction, auto-tag it with "AddedManually", and
   * refresh the list.
   */
  addManualTransaction: (
    title: string,
    description: string,
    amount?: number,
    currency?: string,
    isCash?: boolean
  ) => Promise<void>;
  /**
   * Serialize non-deleted transactions and share them.
   *
   * @param format - "json" produces indented JSON; "csv" produces a
   *   comma-delimited file with tags semicolon-separated inside each cell.
   * @returns The serialized string (useful for tests / previews).
   */
  exportTransactions: (format: "json" | "csv") => Promise<string>;
  /** Create or find a tag by name and link it to a transaction. */
  addTagToTransaction: (transactionId: number, tagName: string) => Promise<void>;
  /** Remove the link between a transaction and a tag. */
  removeTagFromTransaction: (transactionId: number, tagId: number) => void;
  /**
   * Search tags by substring (minimum 2 characters).
   * @returns Up to 10 matching Tag objects.
   */
  searchTags: (query: string) => Tag[];
  /**
   * Delegates to `existsDuplicate` in TransactionRepository.
   * Returns true when a transaction with matching fields exists within
   * ±5 seconds.
   */
  checkDuplicate: (
    title: string | null,
    body: string | null,
    packageName: string | null,
    receivedAt: string
  ) => boolean;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** The ordered column names used in the CSV export. */
const CSV_HEADERS = [
  "Id",
  "ReceivedAt",
  "NotificationTitle",
  "NotificationBody",
  "PackageName",
  "Amount",
  "Currency",
  "IsCash",
  "Tags",
  "IsDeleted",
] as const;

/**
 * Escapes a CSV field value: wraps in double-quotes when the value contains
 * commas, double-quotes, or newlines and escapes inner double-quotes.
 */
function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts the transaction list to a CSV string with the canonical headers.
 *
 * Tags are serialized as a semicolon-separated string within the Tags column.
 *
 * @param transactions - Non-deleted transactions to serialize.
 */
function transactionsToCSV(transactions: Transaction[]): string {
  const headerLine = CSV_HEADERS.join(",");
  const dataLines = transactions.map((tx) => {
    const tagNames = tx.transactionTags
      .map((tt) => {
        // transactionTags only carry tagId; the tag name is not loaded here.
        // We expose the raw tagId as a fallback. The component layer should
        // ensure tag names are populated when the tags are needed.
        return String(tt.tagId);
      })
      .join(";");

    return [
      csvEscape(tx.id),
      csvEscape(tx.receivedAt),
      csvEscape(tx.notificationTitle),
      csvEscape(tx.notificationBody),
      csvEscape(tx.packageName),
      csvEscape(tx.amount),
      csvEscape(tx.currency),
      csvEscape(tx.isCash ? 1 : 0),
      csvEscape(tagNames),
      csvEscape(tx.isDeleted ? 1 : 0),
    ].join(",");
  });

  return [headerLine, ...dataLines].join("\n");
}

/**
 * JSON export row shape — keeps only the fields the CSV spec enumerates so
 * the two formats stay consistent.
 */
interface ExportRow {
  Id: number;
  ReceivedAt: string;
  NotificationTitle: string | null;
  NotificationBody: string | null;
  PackageName: string | null;
  Amount: number | null;
  Currency: string | null;
  IsCash: 0 | 1;
  Tags: string;
  IsDeleted: 0 | 1;
}

/**
 * Converts the transaction list to an indented JSON string.
 * Tags are rendered as a semicolon-separated string of tag ids.
 *
 * @param transactions - Non-deleted transactions to serialize.
 */
function transactionsToJSON(transactions: Transaction[]): string {
  const rows: ExportRow[] = transactions.map((tx) => ({
    Id: tx.id,
    ReceivedAt: tx.receivedAt,
    NotificationTitle: tx.notificationTitle,
    NotificationBody: tx.notificationBody,
    PackageName: tx.packageName,
    Amount: tx.amount,
    Currency: tx.currency,
    IsCash: tx.isCash ? 1 : 0,
    Tags: tx.transactionTags.map((tt) => String(tt.tagId)).join(";"),
    IsDeleted: tx.isDeleted ? 1 : 0,
  }));
  return JSON.stringify(rows, null, 2);
}

// ---------------------------------------------------------------------------
// Default share implementation (Capacitor Share, loaded lazily)
// ---------------------------------------------------------------------------

/**
 * Default share implementation that delegates to the Capacitor Share plugin.
 * Loaded lazily via dynamic import so the module can be used in environments
 * where Capacitor is not available (e.g., unit-test Node process).
 */
const capacitorShare: ShareFn = async (title: string, text: string) => {
  // Dynamic import is resolved to a no-op stub during unit tests via the
  // resolve.alias in vitest.config.ts; in production (Capacitor WebView)
  // the real @capacitor/share package is used.
  const { Share } = await import("@capacitor/share");
  await (Share as { share: (opts: Record<string, string>) => Promise<void> }).share({
    title,
    text,
    dialogTitle: title,
  });
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the transaction list state and exposes CRUD + export actions.
 *
 * @param db - sql.js Database instance (caller is responsible for lifecycle).
 * @param share - Optional share implementation; defaults to Capacitor Share.
 *   Inject a test double to avoid Capacitor in unit tests.
 */
export function useTransactions(
  db: Database,
  share: ShareFn = capacitorShare
): UseTransactionsResult {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [showDeleted, setShowDeleted] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // loadTransactions
  // -------------------------------------------------------------------------

  const loadTransactions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = showDeleted
        ? getAllTransactionsIncludingDeleted(db)
        : getAllTransactions(db);
      setTransactions(rows);
    } finally {
      setLoading(false);
    }
  }, [db, showDeleted]);

  // -------------------------------------------------------------------------
  // softDeleteTransaction
  // -------------------------------------------------------------------------

  const softDeleteTransaction = useCallback(
    async (id: number): Promise<void> => {
      repoSoftDelete(db, id);
      await loadTransactions();
    },
    [db, loadTransactions]
  );

  // -------------------------------------------------------------------------
  // softDeleteAllTransactions
  // -------------------------------------------------------------------------

  const softDeleteAllTransactions = useCallback(async (): Promise<void> => {
    repoSoftDeleteAll(db);
    await loadTransactions();
  }, [db, loadTransactions]);

  // -------------------------------------------------------------------------
  // addManualTransaction
  // -------------------------------------------------------------------------

  const addManualTransaction = useCallback(
    async (
      title: string,
      description: string,
      amount?: number,
      currency?: string,
      isCash?: boolean
    ): Promise<void> => {
      const now = new Date().toISOString();

      const newTx = addTransaction(db, {
        ...createTransaction({
          notificationTitle: title,
          notificationBody: description,
          packageName: "Manual",
          amount: amount ?? null,
          currency: currency ?? null,
          isCash: isCash ?? false,
          receivedAt: now,
        }),
      });

      // Auto-tag with "AddedManually".
      const tag = addTag(db, "AddedManually");
      repoAddTagToTx(db, newTx.id, tag.id);

      await loadTransactions();
    },
    [db, loadTransactions]
  );

  // -------------------------------------------------------------------------
  // exportTransactions
  // -------------------------------------------------------------------------

  const exportTransactions = useCallback(
    async (format: "json" | "csv"): Promise<string> => {
      const rows = getAllTransactions(db); // always non-deleted

      let content: string;
      let title: string;

      if (format === "json") {
        content = transactionsToJSON(rows);
        title = "transactions.json";
      } else {
        content = transactionsToCSV(rows);
        title = "transactions.csv";
      }

      await share(title, content);
      return content;
    },
    [db, share]
  );

  // -------------------------------------------------------------------------
  // Tag management
  // -------------------------------------------------------------------------

  const addTagToTransaction = useCallback(
    async (transactionId: number, tagName: string): Promise<void> => {
      const tag = addTag(db, tagName);
      repoAddTagToTx(db, transactionId, tag.id);
    },
    [db]
  );

  const removeTagFromTransaction = useCallback(
    (transactionId: number, tagId: number): void => {
      repoRemoveTagFromTx(db, transactionId, tagId);
    },
    [db]
  );

  const searchTags = useCallback(
    (query: string): Tag[] => repoSearchTags(db, query),
    [db]
  );

  // -------------------------------------------------------------------------
  // checkDuplicate
  // -------------------------------------------------------------------------

  const checkDuplicate = useCallback(
    (
      title: string | null,
      body: string | null,
      packageName: string | null,
      receivedAt: string
    ): boolean => existsDuplicate(db, title, body, packageName, receivedAt),
    [db]
  );

  return {
    transactions,
    loading,
    showDeleted,
    setShowDeleted,
    loadTransactions,
    softDeleteTransaction,
    softDeleteAllTransactions,
    addManualTransaction,
    exportTransactions,
    addTagToTransaction,
    removeTagFromTransaction,
    searchTags,
    checkDuplicate,
  };
}
