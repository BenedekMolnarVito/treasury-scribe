/**
 * ImportService.ts
 *
 * Imports transactions from the app's own exported CSV or JSON format.
 * Each function accepts a sql.js Database instance and a string of content,
 * returning an {@link ImportResult} with counts and error messages.
 */

import type { Database } from "sql.js";
import { createTransaction } from "../models/Transaction";
import { addTransaction, existsDuplicate, softDeleteTransaction } from "../data/TransactionRepository";
import { addTag, addTagToTransaction } from "../data/TagRepository";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const EXPECTED_COLUMN_COUNT = 10;

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parses a single CSV line into an array of field values, respecting
 * double-quoted fields that may contain commas, newlines, and escaped
 * double-quotes (represented as "").
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let insideQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i]!;

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        insideQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      }
      if (char === ",") {
        fields.push(current);
        current = "";
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  fields.push(current);
  return fields;
}

// ---------------------------------------------------------------------------
// Row-level import helpers
// ---------------------------------------------------------------------------

interface ParsedRow {
  receivedAt: string;
  notificationTitle: string | null;
  notificationBody: string | null;
  packageName: string | null;
  amount: number | null;
  currency: string | null;
  isCash: boolean;
  tags: string[];
  isDeleted: boolean;
}

function parseCSVRow(fields: string[]): ParsedRow {
  const receivedAt = fields[1]!;
  if (!receivedAt) throw new Error("Missing ReceivedAt");

  const rawAmount = fields[5] ?? "";
  const amount = rawAmount === "" ? null : Number(rawAmount);
  if (amount !== null && isNaN(amount)) {
    throw new Error("Invalid Amount: " + rawAmount);
  }

  const rawIsCash = fields[7] ?? "0";
  const rawIsDeleted = fields[9] ?? "0";

  return {
    receivedAt,
    notificationTitle: fields[2] || null,
    notificationBody: fields[3] || null,
    packageName: fields[4] || null,
    amount,
    currency: fields[6] || null,
    isCash: rawIsCash === "1",
    tags: parseTagString(fields[8] ?? ""),
    isDeleted: rawIsDeleted === "1",
  };
}

function parseJSONRow(row: Record<string, unknown>): ParsedRow {
  const receivedAt = row["ReceivedAt"];
  if (typeof receivedAt !== "string" || !receivedAt) {
    throw new Error("Missing or invalid ReceivedAt");
  }

  const rawAmount = row["Amount"];
  const amount =
    rawAmount === null || rawAmount === undefined
      ? null
      : typeof rawAmount === "number"
        ? rawAmount
        : Number(rawAmount);
  if (amount !== null && isNaN(amount)) {
    throw new Error("Invalid Amount");
  }

  const rawCurrency = row["Currency"];
  const currency =
    rawCurrency === null || rawCurrency === undefined
      ? null
      : String(rawCurrency) || null;

  return {
    receivedAt,
    notificationTitle: stringOrNull(row["NotificationTitle"]),
    notificationBody: stringOrNull(row["NotificationBody"]),
    packageName: stringOrNull(row["PackageName"]),
    amount,
    currency,
    isCash: row["IsCash"] === 1 || row["IsCash"] === true,
    tags: parseTagString(
      typeof row["Tags"] === "string" ? row["Tags"] : ""
    ),
    isDeleted:
      row["IsDeleted"] === 1 || row["IsDeleted"] === true,
  };
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str === "" ? null : str;
}

/**
 * Splits a semicolon-separated tag string, unescaping backslash-semicolons
 * to literal semicolons (matching the export escaping in useTransactions.ts).
 * Filters out empty strings.
 */
function parseTagString(raw: string): string[] {
  if (!raw) return [];

  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length && raw[i + 1] === ";") {
      current += ";";
      i++;
    } else if (raw[i] === ";") {
      parts.push(current);
      current = "";
    } else {
      current += raw[i];
    }
  }
  parts.push(current);

  return parts.filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Core import logic (shared by CSV and JSON paths)
// ---------------------------------------------------------------------------

function importParsedRow(db: Database, row: ParsedRow): "imported" | "skipped" {
  if (
    existsDuplicate(
      db,
      row.notificationTitle,
      row.notificationBody,
      row.packageName,
      row.receivedAt
    )
  ) {
    return "skipped";
  }

  const txData = createTransaction({
    receivedAt: row.receivedAt,
    notificationTitle: row.notificationTitle,
    notificationBody: row.notificationBody,
    packageName: row.packageName,
    amount: row.amount,
    currency: row.currency,
    isCash: row.isCash,
    isDeleted: row.isDeleted,
    isIncome: false,
  });

  const savedTx = addTransaction(db, txData);

  // If the row was soft-deleted in the source, apply soft-delete now.
  if (row.isDeleted) {
    softDeleteTransaction(db, savedTx.id);
  }

  // Re-create original tags (regardless of isDeleted state).
  for (const tagName of row.tags) {
    const tag = addTag(db, tagName);
    addTagToTransaction(db, savedTx.id, tag.id);
  }

  return "imported";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import transactions from the app's CSV export format.
 */
export function importFromCSV(db: Database, csvContent: string): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return result;

  // Skip header line
  const dataLines = lines.slice(1);

  for (let i = 0; i < dataLines.length; i++) {
    try {
      const fields = parseCSVLine(dataLines[i]!);
      if (fields.length < EXPECTED_COLUMN_COUNT) {
        result.errors.push(
          "Row " + (i + 1) + ": expected " + EXPECTED_COLUMN_COUNT + " columns, got " + fields.length
        );
        continue;
      }

      const parsed = parseCSVRow(fields);
      const outcome = importParsedRow(db, parsed);

      if (outcome === "imported") result.imported++;
      else result.skipped++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push("Row " + (i + 1) + ": " + message);
    }
  }

  return result;
}

/**
 * Import transactions from the app's JSON export format.
 */
export function importFromJSON(
  db: Database,
  jsonContent: string
): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    result.errors.push("Invalid JSON");
    return result;
  }

  if (!Array.isArray(parsed)) {
    result.errors.push("Expected a JSON array");
    return result;
  }

  for (let i = 0; i < parsed.length; i++) {
    try {
      const row = parsed[i] as Record<string, unknown>;
      const parsedRow = parseJSONRow(row);
      const outcome = importParsedRow(db, parsedRow);

      if (outcome === "imported") result.imported++;
      else result.skipped++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push("Item " + i + ": " + message);
    }
  }

  return result;
}

/**
 * Auto-detect format and import.
 * JSON if content starts with '[', otherwise CSV.
 */
export function importTransactions(
  db: Database,
  content: string
): ImportResult {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("[")) {
    return importFromJSON(db, trimmed);
  }
  return importFromCSV(db, content);
}
