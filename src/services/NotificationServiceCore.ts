import { createTransaction } from "../models/Transaction";
import type { Transaction } from "../models/Transaction";

const REVOLUT_PACKAGE = "com.revolut.revolut";
const DEFAULT_CURRENCY = "HUF";

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

export function isRevolutNotification(packageName: string | null): boolean {
  return packageName === REVOLUT_PACKAGE;
}

export interface ParsedAmountCurrency {
  amount: number | null;
  currency: string | null;
}

export function parseAmountAndCurrency(
  text: string | null
): ParsedAmountCurrency {
  if (!text) return { amount: null, currency: null };

  return (
    tryParseHungarianPayment(text) ??
    tryParseEuropean(text) ??
    tryParseSpaceTrailing(text) ??
    tryParseSpacePrefix(text) ??
    tryParseUS(text) ??
    tryParseBare(text) ??
    { amount: null, currency: null }
  );
}

export function createTransactionFromNotification(
  title: string | null,
  body: string | null,
  packageName: string | null,
  receivedAt = new Date().toISOString()
): Omit<Transaction, "id"> {
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

/**
 * Matches the Hungarian Revolut spending sentence, capturing the spent amount
 * (NOT the remaining balance on the line below).
 *
 * Revolut emits three verb forms for HUF spending:
 *   "1 599 Ft összeget fizettél itt: OBI."         — paid at <merchant>
 *   "4 389 Ft összeget költöttél."                  — spent
 *   "21,23 USD (6 418,43 Ft) összeget vettél fel itt: SST."  — withdrew
 * The balance line that follows ("HUF egyenlege: 27 428,05 Ft" or
 * "A(z) HUF Zseb egyenlege: ...") would otherwise be greedily matched by
 * tryParseEuropean — that pattern is whole-text and ignores line boundaries.
 *
 * This helper accepts both decimal-comma amounts ("18 480,50") and pure
 * space-grouped integer amounts ("18 080"), so the whole-integer "költöttél"
 * notifications (which previously fell through to tryParseEuropean and got
 * the decimal balance back) parse correctly.
 *
 * Currency is always HUF here: the "Ft" suffix is the only currency token in
 * the spend clause. Cross-currency withdrawals like "29,10 EUR (10 401,61 Ft)
 * összeget vettél fel" are matched by tryParseEuropean before this helper
 * runs, which captures the foreign-currency amount.
 */
function tryParseHungarianPayment(text: string): ParsedAmountCurrency | null {
  // Accept either an integer (with optional space-grouped thousands) or a
  // decimal-comma amount; the verbs are "fizett", "költött", or "vett(él|em)
  // fel".
  const match = text.match(
    /(\d{1,3}(?:\s\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*Ft\s+összeget\s+(?:fizett|költött|vett[eé][lm]?\s+fel)/i
  );
  if (!match) return null;

  const amountText = match[1];
  if (!amountText) return null;

  const amount = parseFloat(amountText.replace(/\s/g, "").replace(",", "."));
  if (isNaN(amount)) return null;

  return { amount, currency: "HUF" };
}

function tryParseEuropean(text: string): ParsedAmountCurrency | null {
  const match = text.match(
    /(\d{1,3}(?:\.\d{3})*,\d+)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/i
  );
  if (!match) return null;

  const amountText = match[1];
  const currencyToken = match[2];
  if (!amountText || !currencyToken) return null;

  const amount = parseFloat(amountText.replace(/\./g, "").replace(",", "."));
  if (isNaN(amount)) return null;

  return { amount, currency: resolveCurrencyToken(currencyToken) };
}

function tryParseSpaceTrailing(text: string): ParsedAmountCurrency | null {
  const match = text.match(
    /(\d{1,3}(?:\s\d{3})+)\s+([A-Za-z]{2,4}|[€£¥₹₽₣₩$])(?:\s|$)/
  );
  if (!match) return null;

  const amountText = match[1];
  const currencyToken = match[2];
  if (!amountText || !currencyToken) return null;

  const amount = parseFloat(amountText.replace(/\s/g, ""));
  if (isNaN(amount)) return null;

  return { amount, currency: resolveCurrencyToken(currencyToken) };
}

function tryParseSpacePrefix(text: string): ParsedAmountCurrency | null {
  const match = text.match(
    /([A-Z]{2,4}|[€£¥₹₽₣₩$])\s+(\d{1,3}(?:\s\d{3})*)(?:\s|$)/
  );
  if (!match) return null;

  const currencyToken = match[1];
  const amountText = match[2];
  if (!amountText || !currencyToken) return null;

  const amount = parseFloat(amountText.replace(/\s/g, ""));
  if (isNaN(amount)) return null;

  return { amount, currency: resolveCurrencyToken(currencyToken) };
}

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

function tryParseBare(text: string): ParsedAmountCurrency | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;

  const amountText = match[1];
  if (!amountText) return null;

  const amount = parseFloat(amountText.replace(",", "."));
  if (isNaN(amount)) return null;

  return { amount, currency: null };
}

function resolveCurrencyToken(token: string): string {
  const trimmed = token.trim();
  const upper = trimmed.toUpperCase();
  const mapped = SYMBOL_TO_CURRENCY[trimmed];

  if (mapped) {
    return mapped;
  }

  if (upper === "FT") return "HUF";
  return upper;
}

