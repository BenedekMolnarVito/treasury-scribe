/**
 * Transaction.ts
 *
 * Domain model for a Transaction entity persisted in the Transactions table.
 */

import type { TransactionTag } from "./TransactionTag";

/**
 * Represents a financial transaction derived from an Android notification.
 */
export interface Transaction {
  /** Auto-incremented primary key. */
  id: number;
  /** Raw notification text content. */
  rawContent: string | null;
  /** JSON-serialised structured content. */
  jsonContent: string | null;
  /** ISO 8601 UTC timestamp when the notification was received. */
  receivedAt: string;
  /** Notification title text. */
  notificationTitle: string | null;
  /** Notification body text. */
  notificationBody: string | null;
  /** Android package name of the originating app. */
  packageName: string | null;
  /** Soft-delete flag; true means the row is logically deleted. */
  isDeleted: boolean;
  /** True when this transaction represents a cash payment. */
  isCash: boolean;
  /** Parsed monetary amount. */
  amount: number | null;
  /** ISO 4217 currency code (e.g. "EUR", "HUF"). */
  currency: string | null;
  /** True when the transaction is income (credit), false for expense (debit). */
  isIncome: boolean;
  /** When true this transaction is excluded from merchant auto-learning. */
  excludeFromAutoLearn: boolean;

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  /**
   * Returns `amount` when it is non-null; otherwise attempts to parse the
   * first numeric value out of `jsonContent`.
   */
  parsedAmount: number | null;

  /**
   * Returns `currency` when it is non-null; otherwise falls back to the
   * `currency` field embedded inside `jsonContent` (if it is valid JSON).
   */
  parsedCurrency: string | null;

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  /** All junction rows linking this transaction to its tags. */
  transactionTags: TransactionTag[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to parse `amount` from a JSON string.
 * Returns null if the string is not valid JSON or has no numeric `amount`.
 */
function extractAmountFromJson(json: string | null): number | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const val = parsed["amount"];
    return typeof val === "number" ? val : null;
  } catch {
    return null;
  }
}

/**
 * Attempts to parse `currency` from a JSON string.
 * Returns null if the string is not valid JSON or has no string `currency`.
 */
function extractCurrencyFromJson(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const val = parsed["currency"];
    return typeof val === "string" && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Creates a plain Transaction object with `parsedAmount` and `parsedCurrency`
 * getters already defined. For objects reconstructed from the database (which
 * lack these getters), use {@link withComputedProps} instead.
 */
export function createTransaction(
  fields: Partial<Omit<Transaction, "parsedAmount" | "parsedCurrency" | "id">> &
    Pick<Transaction, "receivedAt">
): Omit<Transaction, "id"> {
  const base: Omit<Transaction, "id"> = {
    rawContent: fields.rawContent ?? null,
    jsonContent: fields.jsonContent ?? null,
    receivedAt: fields.receivedAt,
    notificationTitle: fields.notificationTitle ?? null,
    notificationBody: fields.notificationBody ?? null,
    packageName: fields.packageName ?? null,
    isDeleted: fields.isDeleted ?? false,
    isCash: fields.isCash ?? false,
    amount: fields.amount ?? null,
    currency: fields.currency ?? null,
    isIncome: fields.isIncome ?? false,
    excludeFromAutoLearn: fields.excludeFromAutoLearn ?? false,
    transactionTags: fields.transactionTags ?? [],

    get parsedAmount(): number | null {
      return this.amount ?? extractAmountFromJson(this.jsonContent);
    },
    get parsedCurrency(): string | null {
      return this.currency ?? extractCurrencyFromJson(this.jsonContent);
    },
  };
  return base;
}

/**
 * Attaches `parsedAmount` / `parsedCurrency` computed getters to a raw
 * Transaction object that was reconstructed from the database (and therefore
 * lacks them).
 *
 * @param raw - A Transaction-shaped object without computed properties.
 * @returns The same object with getters added in-place and returned.
 */
export function withComputedProps(raw: Transaction): Transaction {
  Object.defineProperty(raw, "parsedAmount", {
    get(this: Transaction) {
      return this.amount ?? extractAmountFromJson(this.jsonContent);
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(raw, "parsedCurrency", {
    get(this: Transaction) {
      return this.currency ?? extractCurrencyFromJson(this.jsonContent);
    },
    enumerable: true,
    configurable: true,
  });
  return raw;
}
