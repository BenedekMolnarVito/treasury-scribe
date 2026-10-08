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
 * Matches the amount clause of a Hungarian Revolut notification — the amount
 * directly in front of "összeget" / "összegű" ("the sum"):
 *   "1 599 Ft összeget fizettél itt: OBI."             — paid at <merchant>
 *   "9 040 Ft összeget költöttél."                      — spent
 *   "4 482,82 Ft (13,72 USD) összeget vettél fel itt:"  — charged, with FX
 *   "10 USD (3 299,96 Ft) összeget vettél fel itt:"     — charged, with FX
 *   "20 168 Ft összeget küldtél neki: …"                — sent
 *   "… küldött, 20 168 Ft összegű átutalás teljesült."  — transfer completed
 *
 * Anchoring on the noun instead of the verb keeps working when Revolut
 * rewords the verb (the "fizettél" → "költöttél" switch caused this bug).
 * Revolut groups thousands with NBSP; JS `\s` covers it.
 *
 * FX charges carry two amounts. The Ft one is preferred (whichever side of
 * the parenthesis it is on) because dashboard aggregates SUM(Amount) without
 * currency conversion; the foreign amount is kept only if no Ft amount exists.
 *
 * Must run before tryParseEuropean, which would otherwise match the balance
 * amount on the second line ("HUF egyenlege: 26 249,55 Ft").
 */
const HU_AMOUNT = String.raw`(?<!\d)\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|(?<!\d)\d+(?:,\d+)?`;
const HU_CURRENCY = String.raw`Ft|[A-Z]{3}|[€£¥₹₽₣₩$]`;
const REVOLUT_HU_AMOUNT_CLAUSE = new RegExp(
  String.raw`(${HU_AMOUNT})\s*(${HU_CURRENCY})` +
    String.raw`(?:\s*\(\s*(${HU_AMOUNT})\s*(${HU_CURRENCY})\s*\))?` +
    String.raw`\s*összeg(?:et|ű)`,
  'i'
);

function tryParseHungarianPayment(text: string): ParsedAmountCurrency | null {
  const match = text.match(REVOLUT_HU_AMOUNT_CLAUSE);
  if (!match) return null;

  const [, chargedAmount, chargedCurrency, convertedAmount, convertedCurrency] =
    match;
  if (!chargedAmount || !chargedCurrency) return null;

  const useConverted =
    resolveCurrencyToken(chargedCurrency) !== "HUF" &&
    convertedAmount !== undefined &&
    convertedCurrency !== undefined &&
    resolveCurrencyToken(convertedCurrency) === "HUF";

  const amountText = useConverted ? convertedAmount : chargedAmount;
  const currencyToken = useConverted ? convertedCurrency : chargedCurrency;

  const amount = parseFloat(amountText.replace(/\s/g, "").replace(",", "."));
  if (isNaN(amount)) return null;

  return { amount, currency: resolveCurrencyToken(currencyToken) };
}

function tryParseEuropean(text: string): ParsedAmountCurrency | null {
  // Thousands may be grouped with "." or with (NB)space: "1.234,56" / "1 234,56".
  const match = text.match(
    /(\d{1,3}(?:[.\s]\d{3})*,\d+)\s*([A-Z]{2,4}|[€£¥₹₽₣₩$])/i
  );
  if (!match) return null;

  const amountText = match[1];
  const currencyToken = match[2];
  if (!amountText || !currencyToken) return null;

  const amount = parseFloat(amountText.replace(/[.\s]/g, "").replace(",", "."));
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

