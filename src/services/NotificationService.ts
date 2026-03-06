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
 * 2. **US**       – `$1,234.56`     (comma thousands, period decimal, leading symbol)
 * 3. **Symbol-prefixed plain** – `$50.00`
 * 4. **Space-separated with trailing code/symbol** – `6 337 Ft`
 * 5. **Code-prefixed space-separated** – `HUF 1 234`
 *
 * @param text - Raw notification body or title text.
 * @returns `{ amount, currency }` where either field may be `null` if not found.
 */
export function parseAmountAndCurrency(
  text: string | null
): ParsedAmountCurrency {
  if (!text) return { amount: null, currency: null };

  // -------------------------------------------------------------------------
  // 1. European format: 1.234,56 EUR  /  1.234,56€
  //    Thousands separator = period, decimal separator = comma.
  // -------------------------------------------------------------------------
  const europeanRegex =
    /(\d{1,3}(?:\.\d{3})*,\d+)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/i;
  const europeanMatch = text.match(europeanRegex);
  if (europeanMatch) {
    const raw = europeanMatch[1].replace(/\./g, "").replace(",", ".");
    const amount = parseFloat(raw);
    const currency = resolveCurrencyToken(europeanMatch[2]);
    if (!isNaN(amount)) return { amount, currency };
  }

  // -------------------------------------------------------------------------
  // 2. Space-separated with trailing code/symbol: 6 337 Ft  /  10 000 HUF
  //    Two or more groups of digits separated by single spaces, followed by a
  //    currency token.  Requires at least one \s\d{3} repetition to avoid
  //    false-positive matches inside US-format strings.
  // -------------------------------------------------------------------------
  const spaceTrailingRegex =
    /(\d{1,3}(?:\s\d{3})+)\s+([A-Za-z]{2,4}|[€£¥₹₽₣₩$])(?:\s|$)/;
  const spaceTrailingMatch = text.match(spaceTrailingRegex);
  if (spaceTrailingMatch) {
    const raw = spaceTrailingMatch[1].replace(/\s/g, "");
    const amount = parseFloat(raw);
    const currency = resolveCurrencyToken(spaceTrailingMatch[2]);
    if (!isNaN(amount)) return { amount, currency };
  }

  // -------------------------------------------------------------------------
  // 3. Code-prefixed space-separated: HUF 1 234  /  EUR 500
  //    Currency token first, then a number (space-grouped or plain).
  // -------------------------------------------------------------------------
  const spacePrefixRegex =
    /([A-Z]{2,4}|[€£¥₹₽₣₩$])\s+(\d{1,3}(?:\s\d{3})*)(?:\s|$)/;
  const spacePrefixMatch = text.match(spacePrefixRegex);
  if (spacePrefixMatch) {
    const raw = spacePrefixMatch[2].replace(/\s/g, "");
    const amount = parseFloat(raw);
    const currency = resolveCurrencyToken(spacePrefixMatch[1]);
    if (!isNaN(amount)) return { amount, currency };
  }

  // -------------------------------------------------------------------------
  // 4. US format: $1,234.56  /  1,234.56 USD
  //    Thousands separator = comma, decimal separator = period.
  //    Leading currency symbol or trailing ISO code.
  // -------------------------------------------------------------------------
  const usRegex =
    /([€£¥₹₽₣₩$])(\d{1,3}(?:,\d{3})*(?:\.\d+)?)|(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/;
  const usMatch = text.match(usRegex);
  if (usMatch) {
    if (usMatch[1] && usMatch[2]) {
      // Leading symbol: $1,234.56
      const raw = usMatch[2].replace(/,/g, "");
      const amount = parseFloat(raw);
      const currency = resolveCurrencyToken(usMatch[1]);
      if (!isNaN(amount)) return { amount, currency };
    } else if (usMatch[3] && usMatch[4]) {
      // Trailing code: 1,234.56 USD
      const raw = usMatch[3].replace(/,/g, "");
      const amount = parseFloat(raw);
      const currency = resolveCurrencyToken(usMatch[4]);
      if (!isNaN(amount)) return { amount, currency };
    }
  }

  // -------------------------------------------------------------------------
  // 5. Bare amount with no currency context (last resort)
  // -------------------------------------------------------------------------
  const bareRegex = /(\d+(?:[.,]\d+)?)/;
  const bareMatch = text.match(bareRegex);
  if (bareMatch) {
    const raw = bareMatch[1].replace(",", ".");
    const amount = parseFloat(raw);
    if (!isNaN(amount)) return { amount, currency: null };
  }

  return { amount: null, currency: null };
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
// Internal helpers
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
