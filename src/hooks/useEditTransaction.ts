/**
 * useEditTransaction.ts
 *
 * React hook that manages the edit-transaction screen state and actions.
 * Wraps TransactionRepository and TagRepository behind a clean stateful API,
 * keeping all editable copies of the transaction fields in local state so
 * the UI can bind to them directly without touching the database on every
 * keystroke.
 */

import { useState, useRef, useCallback } from "react";
import type { Database } from "sql.js";
import type { Tag } from "../models/Tag";
import type { DatabaseChangedFn } from "./useTransactions";

import { getTransactionById, updateTransaction } from "../data/TransactionRepository";
import {
  addTag as repoAddTag,
  addTagToTransaction,
  removeTagFromTransaction,
  searchTags as repoSearchTags,
  getMostCommonTags,
  getTagsForTransaction,
} from "../data/TagRepository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce delay (ms) applied to {@link UseEditTransactionResult.searchTags}. */
const SEARCH_DEBOUNCE_MS = 300;

/** Number of recent tags returned by {@link UseEditTransactionResult.loadRecentTags}. */
const RECENT_TAGS_LIMIT = 5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Everything the hook exposes to the UI layer. */
export interface UseEditTransactionResult {
  // -------------------------------------------------------------------------
  // Editable state
  // -------------------------------------------------------------------------

  /** Editable copy of `notificationTitle`. */
  title: string;
  /** Editable copy of `notificationBody`. */
  description: string;
  /** Editable copy of `isCash`. */
  isCash: boolean;
  /** Editable copy of `isIncome`. */
  isIncome: boolean;
  /** Editable copy of `amount`. */
  amount: number | null;
  /** Editable copy of `currency`. */
  currency: string;
  /** Controlled input value for the "add tag" text field. */
  newTagName: string;
  /** Tags currently linked to the transaction. */
  currentTags: Tag[];
  /** Top-5 most commonly used tags across all transactions. */
  recentTags: Tag[];
  /** Tags returned by the most recent debounced search. */
  searchResults: Tag[];

  // -------------------------------------------------------------------------
  // Setters
  // -------------------------------------------------------------------------

  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setIsCash: (value: boolean) => void;
  setIsIncome: (value: boolean) => void;
  setAmount: (value: number | null) => void;
  setCurrency: (value: string) => void;
  setNewTagName: (value: string) => void;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Load a transaction from the repository and populate all editable state
   * fields from it.
   *
   * @param id - Primary key of the transaction to edit.
   * @throws If no transaction with the given id exists.
   */
  loadTransaction: (id: number) => void;

  /**
   * Persist the current editable state back to the database.
   * No-op when no transaction has been loaded yet.
   */
  save: () => void;

  /**
   * Create or find a tag with the given name, link it to the current
   * transaction, and update {@link currentTags}.
   *
   * @param name - Tag name to create or find.
   */
  addTag: (name: string) => void;

  /**
   * Unlink the tag identified by `tagId` from the current transaction and
   * update {@link currentTags}.
   *
   * @param tagId - Primary key of the tag to remove.
   */
  removeTag: (tagId: number) => void;

  /**
   * Trigger a debounced tag search.  The search fires after 300 ms of
   * inactivity and only when `query` is at least 2 characters long.
   * Results are written to {@link searchResults}.
   *
   * @param query - Substring to match against tag names.
   */
  searchTags: (query: string) => void;

  /**
   * Populate {@link recentTags} with the top-5 most commonly used tags.
   */
  loadRecentTags: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the edit-transaction form state and exposes save / tag actions.
 *
 * @param db - sql.js Database instance (caller is responsible for lifecycle).
 */
export function useEditTransaction(
  db: Database,
  onDatabaseChanged: DatabaseChangedFn = () => undefined
): UseEditTransactionResult {
  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** Primary key of the transaction currently being edited. */
  const transactionIdRef = useRef<number | null>(null);

  // Editable fields
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isCash, setIsCash] = useState<boolean>(false);
  const [isIncome, setIsIncome] = useState<boolean>(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("HUF");
  const [newTagName, setNewTagName] = useState<string>("");

  // Tag collections
  const [currentTags, setCurrentTags] = useState<Tag[]>([]);
  const [recentTags, setRecentTags] = useState<Tag[]>([]);
  const [searchResults, setSearchResults] = useState<Tag[]>([]);

  /** Timer handle for the debounced search. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // loadTransaction
  // -------------------------------------------------------------------------

  const loadTransaction = useCallback(
    (id: number): void => {
      const tx = getTransactionById(db, id);
      if (!tx) {
        throw new Error(`Transaction with id ${id} not found`);
      }

      transactionIdRef.current = id;
      setTitle(tx.notificationTitle ?? "");
      setDescription(tx.notificationBody ?? "");
      setIsCash(tx.isCash);
      setIsIncome(tx.isIncome);
      setAmount(tx.amount);
      setCurrency(tx.currency ?? "HUF");
      setNewTagName("");

      // Eagerly load the full Tag objects (name + metadata) for the current tags.
      const tags = getTagsForTransaction(db, id);
      setCurrentTags(tags);
    },
    [db]
  );

  // -------------------------------------------------------------------------
  // save
  // -------------------------------------------------------------------------

  const save = useCallback((): void => {
    const id = transactionIdRef.current;
    if (id === null) return;

    const tx = getTransactionById(db, id);
    if (!tx) return;

    updateTransaction(db, {
      ...tx,
      notificationTitle: title,
      notificationBody: description,
      isCash,
      isIncome,
      amount,
      currency,
    });
    onDatabaseChanged(db);
  }, [db, title, description, isCash, isIncome, amount, currency, onDatabaseChanged]);

  // -------------------------------------------------------------------------
  // addTag
  // -------------------------------------------------------------------------

  const addTag = useCallback(
    (name: string): void => {
      const id = transactionIdRef.current;
      if (id === null) return;

      const tag = repoAddTag(db, name);
      addTagToTransaction(db, id, tag.id);

      // Refresh current tags from the database to stay consistent.
      setCurrentTags(getTagsForTransaction(db, id));
      onDatabaseChanged(db);
    },
    [db, onDatabaseChanged]
  );

  // -------------------------------------------------------------------------
  // removeTag
  // -------------------------------------------------------------------------

  const removeTag = useCallback(
    (tagId: number): void => {
      const id = transactionIdRef.current;
      if (id === null) return;

      removeTagFromTransaction(db, id, tagId);
      setCurrentTags((prev) => prev.filter((t) => t.id !== tagId));
      onDatabaseChanged(db);
    },
    [db, onDatabaseChanged]
  );

  // -------------------------------------------------------------------------
  // searchTags (debounced, min 2 chars)
  // -------------------------------------------------------------------------

  const searchTags = useCallback(
    (query: string): void => {
      // Cancel any pending debounced search.
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      debounceRef.current = setTimeout(() => {
        setSearchResults(repoSearchTags(db, query));
        debounceRef.current = null;
      }, SEARCH_DEBOUNCE_MS);
    },
    [db]
  );

  // -------------------------------------------------------------------------
  // loadRecentTags
  // -------------------------------------------------------------------------

  const loadRecentTags = useCallback((): void => {
    setRecentTags(getMostCommonTags(db, RECENT_TAGS_LIMIT));
  }, [db]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    title,
    description,
    isCash,
    isIncome,
    amount,
    currency,
    newTagName,
    currentTags,
    recentTags,
    searchResults,

    setTitle,
    setDescription,
    setIsCash,
    setIsIncome,
    setAmount,
    setCurrency,
    setNewTagName,

    loadTransaction,
    save,
    addTag,
    removeTag,
    searchTags,
    loadRecentTags,
  };
}
