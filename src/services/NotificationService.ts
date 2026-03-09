/**
 * NotificationService.ts
 *
 * Parses Android notification payloads into Transaction domain objects.
 * Supports Revolut and generic financial notification formats.
 */

import { createTransaction } from "../models/Transaction";
import type { Transaction } from "../models/Transaction";

/** The exact Android package name for the Revolut app. */
const REVOLUT_PACKAGE = "com.revolut.revolut";

/** Default currency when none can be detected from the notification text. */
const DEFAULT_CURRENCY = "HUF";

// ---------------------------------------------------------------------------
// Currency symbol → ISO 4217 code mapping
// ---------------------------------------------------------------------------

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₣": "CHF",
  "₩": "KRW",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `packageName` is exactly the Revolut Android app ID.
 *
 * @param packageName - The `android.app.extra.PACKAGE_NAME` value from the
 *   notification intent.
 */
export function isRevolutNotification(packageName: string | null): boolean {
  return packageName === REVOLUT_PACKAGE;
}

/** Result type returned by {@link parseAmountAndCurrency}. */
export interface ParsedAmountCurrency {
  /** Parsed monetary amount, or `null` when no amount is found. */
  amount: number | null;
  /** ISO 4217 currency code, or `null` when none is detected. */
  currency: string | null;
}

/**
 * Extracts a monetary amount and currency code from a free-form notification
 * text string.
 *
 * Supported formats (in order of matching priority):
 * 1. **European** – `1.234,56 EUR`  (period thousands, comma decimal)
 * 2. **Space-separated with trailing code/symbol** – `6 337 Ft`
 * 3. **Code-prefixed space-separated** – `HUF 1 234`
 * 4. **US** – `$1,234.56` or `1,234.56 USD` (comma thousands, period decimal)
 * 5. **Bare amount (last resort)** – `50.00` (no currency context)
 *
 * @param text - Raw notification body or title text.
 * @returns `{ amount, currency }` where either field may be `null` if not found.
 */
export function parseAmountAndCurrency(
  text: string | null
): ParsedAmountCurrency {
  if (!text) return { amount: null, currency: null };

  return (
    tryParseEuropean(text) ??
    tryParseSpaceTrailing(text) ??
    tryParseSpacePrefix(text) ??
    tryParseUS(text) ??
    tryParseBare(text) ??
    { amount: null, currency: null }
  );
}

/**
 * Builds a complete {@link Transaction} (without a database `id`) from raw
 * Android notification fields.
 *
 * - `receivedAt` is set to the current UTC instant in ISO 8601 format.
 * - `currency` defaults to `"HUF"` when {@link parseAmountAndCurrency} cannot
 *   detect one.
 * - `jsonContent` is a JSON-serialised object containing all structured fields.
 * - `rawContent` is the concatenated title + body string.
 *
 * @param title       - Notification title (may be `null`).
 * @param body        - Notification body text (may be `null`).
 * @param packageName - Source app package name (may be `null`).
 * @returns A fully-populated Transaction without an `id`.
 */
export function createTransactionFromNotification(
  title: string | null,
  body: string | null,
  packageName: string | null
): Omit<Transaction, "id"> {
  const receivedAt = new Date().toISOString();
  const rawText = [title, body].filter(Boolean).join(" ");
  const { amount, currency: detectedCurrency } = parseAmountAndCurrency(
    rawText || null
  );
  const currency = detectedCurrency ?? DEFAULT_CURRENCY;

  const jsonContent = JSON.stringify({
    title,
    body,
    packageName,
    timestamp: receivedAt,
    rawText,
    amount,
    currency,
  });

  return createTransaction({
    rawContent: rawText || null,
    jsonContent,
    receivedAt,
    notificationTitle: title,
    notificationBody: body,
    packageName,
    amount,
    currency,
    isDeleted: false,
    isCash: false,
    isIncome: false,
    transactionTags: [],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers – format-specific parsers (CC ≤ 3 each)
// ---------------------------------------------------------------------------

/**
 * Tries European format: 1.234,56 EUR / 1.234,56€
 * (period thousands separator, comma decimal separator)
 */
function tryParseEuropean(text: string): ParsedAmountCurrency | null {
  const match = text.match(/(\d{1,3}(?:\.\d{3})*,\d+)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/i);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/\./g, "").replace(",", "."));
  if (isNaN(amount)) return null;
  return { amount, currency: resolveCurrencyToken(match[2]) };
}

/**
 * Tries space-separated digits with a trailing code/symbol: 6 337 Ft / 10 000 HUF
 * Requires at least one \s\d{3} group to avoid false-positive matches inside US strings.
 */
function tryParseSpaceTrailing(text: string): ParsedAmountCurrency | null {
  const match = text.match(/(\d{1,3}(?:\s\d{3})+)\s+([A-Za-z]{2,4}|[€£¥₹₽₣₩$])(?:\s|$)/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/\s/g, ""));
  if (isNaN(amount)) return null;
  return { amount, currency: resolveCurrencyToken(match[2]) };
}

/**
 * Tries code-prefixed space-separated digits: HUF 1 234 / EUR 500
 */
function tryParseSpacePrefix(text: string): ParsedAmountCurrency | null {
  const match = text.match(/([A-Z]{2,4}|[€£¥₹₽₣₩$])\s+(\d{1,3}(?:\s\d{3})*)(?:\s|$)/);
  if (!match) return null;
  const amount = parseFloat(match[2].replace(/\s/g, ""));
  if (isNaN(amount)) return null;
  return { amount, currency: resolveCurrencyToken(match[1]) };
}

/**
 * Tries US format: $1,234.56 (leading symbol) or 1,234.56 USD (trailing code/symbol)
 * (comma thousands separator, period decimal separator)
 */
function tryParseUS(text: string): ParsedAmountCurrency | null {
  const match = text.match(
    /([€£¥₹₽₣₩$])(\d{1,3}(?:,\d{3})*(?:\.\d+)?)|(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/
  );
  if (!match) return null;
  if (match[1] && match[2]) {
    const amount = parseFloat(match[2].replace(/,/g, ""));
    if (isNaN(amount)) return null;
    return { amount, currency: resolveCurrencyToken(match[1]) };
  }
  if (match[3] && match[4]) {
    const amount = parseFloat(match[3].replace(/,/g, ""));
    if (isNaN(amount)) return null;
    return { amount, currency: resolveCurrencyToken(match[4]) };
  }
  return null;
}

/**
 * Tries a bare number with no currency context (last resort): 50.00 / 1,500
 */
function tryParseBare(text: string): ParsedAmountCurrency | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(",", "."));
  if (isNaN(amount)) return null;
  return { amount, currency: null };
}

// ---------------------------------------------------------------------------
// Internal helpers – currency resolution
// ---------------------------------------------------------------------------

/**
 * Converts a raw currency token (ISO code or symbol) to an uppercase ISO code.
 *
 * @param token - A string like `"EUR"`, `"Ft"`, `"$"`, etc.
 * @returns Uppercase ISO code, or the uppercased token if unrecognised.
 */
function resolveCurrencyToken(token: string): string {
  const upper = token.trim().toUpperCase();
  // Map known symbols
  if (SYMBOL_TO_CURRENCY[token.trim()]) {
    return SYMBOL_TO_CURRENCY[token.trim()];
  }
  // "Ft" is the Hungarian Forint sign → HUF
  if (upper === "FT") return "HUF";
  return upper;
}
