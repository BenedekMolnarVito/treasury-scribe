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

import { ingestNotification as serviceIngestNotification } from "../services/IngestionService";
import { parseAmountAndCurrency } from "../services/NotificationService";

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
export type DatabaseChangedFn = (db: Database) => void;

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
    isCash?: boolean,
    isIncome?: boolean,
    receivedAt?: string,
    excludeFromAutoLearn?: boolean
  ) => Promise<void>;
  /**
   * Serialize all transactions (including soft-deleted) and share them.
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
  /**
   * Ingests a notification, applying all smart behaviours:
   * deduplication, auto-soft-delete, and auto-tag by vendor.
   *
   * @returns The persisted transaction, or `null` when it was a duplicate
   *   and was silently skipped.
   */
  ingestNotification: (
    title: string | null,
    body: string | null,
    packageName: string | null
  ) => Promise<Transaction | null>;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * Returns the human-readable tag name when available; falls back to the raw
 * tagId when the name is unexpectedly absent.
 */
function getTagDisplayName(tt: { tagName?: string; tagId: number }): string {
  return tt.tagName && tt.tagName.length > 0 ? tt.tagName : String(tt.tagId);
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
 * Tags are serialized as a semicolon-separated string of tag names within the
 * Tags column. When a tag name is unexpectedly absent, the raw tagId is used
 * as a fallback.
 *
 * @param transactions - Non-deleted transactions to serialize.
 */
function transactionsToCSV(transactions: Transaction[]): string {
  const headerLine = CSV_HEADERS.join(",");
  const dataLines = transactions.map((tx) => {
    const tagNames = tx.transactionTags
      .map((tt) => {
        // Prefer the human-readable tagName when available, but fall back to
        // the raw tagId if the name is unexpectedly missing.
        // Escape semicolons in individual tag names so they are not confused
        // with the semicolon separator between tags.
        return getTagDisplayName(tt).replace(/;/g, "\\;");
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
 * Tags are rendered as a semicolon-separated string of tag names (falling
 * back to the raw tagId when the name is unexpectedly missing).
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
    Tags: tx.transactionTags
      .map((tt) => getTagDisplayName(tt).replace(/;/g, "\\;"))
      .join(";"),
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
async function downloadExportFile(title: string, text: string): Promise<void> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }

  const blob = new Blob([text], {
    type: title.endsWith(".json")
      ? "application/json;charset=utf-8"
      : "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = title;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const capacitorShare: ShareFn = async (title: string, text: string) => {
  try {
    const { Share } = await import("@capacitor/share");
    await (
      Share as unknown as { share?: (opts: Record<string, string>) => Promise<unknown> }
    ).share?.({
      title,
      text,
      dialogTitle: title,
    });
    return;
  } catch {
    // Fall through to the browser download fallback below.
  }

  await downloadExportFile(title, text);
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
  share: ShareFn = capacitorShare,
  onDatabaseChanged: DatabaseChangedFn = () => undefined
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
      onDatabaseChanged(db);
      await loadTransactions();
    },
    [db, loadTransactions, onDatabaseChanged]
  );

  // -------------------------------------------------------------------------
  // softDeleteAllTransactions
  // -------------------------------------------------------------------------

  const softDeleteAllTransactions = useCallback(async (): Promise<void> => {
    repoSoftDeleteAll(db);
    onDatabaseChanged(db);
    await loadTransactions();
  }, [db, loadTransactions, onDatabaseChanged]);

  // -------------------------------------------------------------------------
  // addManualTransaction
  // -------------------------------------------------------------------------

  const addManualTransaction = useCallback(
    async (
      title: string,
      description: string,
      amount?: number,
      currency?: string,
      isCash?: boolean,
      isIncome?: boolean,
      receivedAt?: string,
      excludeFromAutoLearn?: boolean
    ): Promise<void> => {
      const now = receivedAt ?? new Date().toISOString();

      const newTx = addTransaction(db, {
        ...createTransaction({
          notificationTitle: title,
          notificationBody: description,
          packageName: "Manual",
          amount: amount ?? null,
          currency: currency ?? null,
          isCash: isCash ?? false,
          isIncome: isIncome ?? false,
          excludeFromAutoLearn: excludeFromAutoLearn ?? false,
          receivedAt: now,
        }),
      });

      // Auto-tag with "AddedManually".
      const tag = addTag(db, "AddedManually");
      repoAddTagToTx(db, newTx.id, tag.id);
      onDatabaseChanged(db);

      await loadTransactions();
    },
    [db, loadTransactions, onDatabaseChanged]
  );

  // -------------------------------------------------------------------------
  // exportTransactions
  // -------------------------------------------------------------------------

  const exportTransactions = useCallback(
    async (format: "json" | "csv"): Promise<string> => {
      const rows = getAllTransactionsIncludingDeleted(db); // includes soft-deleted for full round-trip fidelity

      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        "_",
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");

      let content: string;
      let title: string;

      if (format === "json") {
        content = transactionsToJSON(rows);
        title = `treasury-scribe-transactions_${timestamp}.json`;
      } else {
        content = transactionsToCSV(rows);
        title = `treasury-scribe-transactions_${timestamp}.csv`;
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
      onDatabaseChanged(db);
    },
    [db, onDatabaseChanged]
  );

  const removeTagFromTransaction = useCallback(
    (transactionId: number, tagId: number): void => {
      repoRemoveTagFromTx(db, transactionId, tagId);
      onDatabaseChanged(db);
    },
    [db, onDatabaseChanged]
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

  // -------------------------------------------------------------------------
  // ingestNotification
  // -------------------------------------------------------------------------

  const ingestNotification = useCallback(
    async (
      title: string | null,
      body: string | null,
      packageName: string | null
    ): Promise<Transaction | null> => {
      const receivedAt = new Date().toISOString();
      const rawText = [title, body].filter(Boolean).join(" ");
      const { amount, currency: detectedCurrency } = parseAmountAndCurrency(
        rawText || null
      );
      const currency = detectedCurrency ?? "HUF";
      const result = serviceIngestNotification(db, {
        notificationTitle: title,
        notificationBody: body,
        packageName,
        receivedAt,
        rawContent: rawText || null,
        jsonContent: JSON.stringify({
          title, body, packageName, timestamp: receivedAt, rawText, amount, currency,
        }),
        amount,
        currency,
        isDeleted: false,
        isCash: false,
        isIncome: false,
      });
      if (result !== null) {
        onDatabaseChanged(db);
        await loadTransactions();
      }
      return result;
    },
    [db, loadTransactions, onDatabaseChanged]
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
    ingestNotification,
  };
}
