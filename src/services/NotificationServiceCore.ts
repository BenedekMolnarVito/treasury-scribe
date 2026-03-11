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

