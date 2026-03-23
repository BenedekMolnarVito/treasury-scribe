/**
 * RevolutImportService.ts
 *
 * Parses Revolut Hungarian CSV exports and imports transactions into the
 * SQLite database.  Handles UTF-8 BOM encoding, deduplication against
 * existing transactions, and automatic tagging of all imported rows with
 * the "RevolutImport" tag.
 */

import type { Database } from "sql.js";
import { createTransaction } from "../models/Transaction";
import { addTransaction } from "../data/TransactionRepository";
import { addTag, addTagToTransaction } from "../data/TagRepository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVOLUT_PACKAGE_NAME = "com.revolut.revolut";
const REVOLUT_IMPORT_TAG = "RevolutImport";
const BOM = "\uFEFF";
const SECONDS_PER_DAY = 86_400;

/** Revolut CSV types that are skipped entirely during import. */
const SKIPPED_TYPES: ReadonlySet<string> = new Set(["Átváltás"]);

/** All Revolut CSV types eligible for import. */
const IMPORTABLE_TYPES: ReadonlySet<string> = new Set([
  "Kártyás fizetés",
  "Átutalás",
  "Feltöltés",
  "Kártyás visszatérítés",
]);

/** Maps logical field roles to Hungarian CSV header names. */
const HEADER_NAMES = {
  type: "Típus",
  description: "Leírás",
  amount: "Összeg",
  currency: "Pénznem",
  startDate: "Kezdés dátuma",
  state: "State",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single parsed row from the Revolut CSV. */
interface RevolutCsvRow {
  type: string;
  description: string;
  amount: number;
  currency: string;
  startDate: string;
}

/** Summary returned after a CSV import operation. */
export interface RevolutImportSummary {
  imported: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Parses a single CSV line into fields, respecting double-quote escaping.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

type HeaderIndices = Record<keyof typeof HEADER_NAMES, number>;

/**
 * Resolves column indices from the parsed header row.
 * Throws when a required header is missing.
 */
function resolveHeaderIndices(headerFields: string[]): HeaderIndices {
  const indices = {} as HeaderIndices;

  for (const [key, hungarianName] of Object.entries(HEADER_NAMES)) {
    const index = headerFields.indexOf(hungarianName);
    if (index === -1) {
      throw new Error(`Missing required CSV header: "${hungarianName}"`);
    }
    indices[key as keyof typeof HEADER_NAMES] = index;
  }

  return indices;
}

/**
 * Converts a Revolut datetime string ("2026-01-31 12:21:56") to ISO 8601.
 */
function toIso8601(revolutDate: string): string {
  return revolutDate.replace(" ", "T");
}

/**
 * Parses a data row into a {@link RevolutCsvRow}.
 * Returns `null` when the row is malformed (missing fields, unparseable amount).
 */
function parseDataRow(
  fields: string[],
  indices: HeaderIndices
): RevolutCsvRow | null {
  const maxRequiredIndex = Math.max(...Object.values(indices));
  if (fields.length <= maxRequiredIndex) return null;

  const amountRaw = fields[indices.amount];
  const amount = parseFloat(amountRaw);
  if (Number.isNaN(amount)) return null;

  const startDate = fields[indices.startDate];
  if (!startDate) return null;

  return {
    type: fields[indices.type],
    description: fields[indices.description],
    amount,
    currency: fields[indices.currency],
    startDate,
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Checks whether a transaction with the same vendor name, absolute amount,
 * and a receivedAt timestamp within ±1 day already exists.
 */
function isDuplicateInDb(
  db: Database,
  title: string,
  absoluteAmount: number,
  receivedAt: string
): boolean {
  const stmt = db.prepare(
    `SELECT COUNT(*) AS cnt
     FROM Transactions
     WHERE NotificationTitle IS ?
       AND Amount IS NOT NULL
       AND ABS(Amount) = ?
       AND ABS(julianday(ReceivedAt) - julianday(?)) * 86400.0 <= ?`
  );
  stmt.bind([
    title,
    absoluteAmount,
    receivedAt,
    SECONDS_PER_DAY + 0.0001,
  ] as Parameters<typeof stmt.bind>[0]);

  let count = 0;
  if (stmt.step()) {
    count = (stmt.getAsObject() as { cnt: number }).cnt;
  }
  stmt.free();
  return count > 0;
}

// ---------------------------------------------------------------------------
// Notification body builder
// ---------------------------------------------------------------------------

function buildNotificationBody(type: string, description: string): string {
  return `${type}: ${description}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Imports transactions from a Revolut Hungarian CSV string.
 *
 * - Strips UTF-8 BOM if present.
 * - Skips currency exchange rows ("Átváltás").
 * - Deduplicates against existing transactions (same vendor, same absolute
 *   amount, receivedAt within ±1 day).
 * - Never deletes existing transactions.
 *
 * @param db         - sql.js Database instance.
 * @param csvContent - Raw CSV text (may include UTF-8 BOM).
 * @returns Summary with imported and skipped counts.
 */
export function importRevolutCsv(
  db: Database,
  csvContent: string
): RevolutImportSummary {
  const cleanContent = stripBom(csvContent);
  const lines = cleanContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const headerFields = parseCsvLine(lines[0]);
  let indices: HeaderIndices;
  try {
    indices = resolveHeaderIndices(headerFields);
  } catch {
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = parseDataRow(fields, indices);

    if (row === null) {
      skipped++;
      continue;
    }

    if (SKIPPED_TYPES.has(row.type)) {
      skipped++;
      continue;
    }

    if (!IMPORTABLE_TYPES.has(row.type)) {
      skipped++;
      continue;
    }

    const absoluteAmount = Math.abs(row.amount);
    const isIncome = row.amount > 0;
    const receivedAt = toIso8601(row.startDate);

    if (isDuplicateInDb(db, row.description, absoluteAmount, receivedAt)) {
      skipped++;
      continue;
    }

    const txData = createTransaction({
      notificationTitle: row.description,
      notificationBody: buildNotificationBody(row.type, row.description),
      amount: absoluteAmount,
      currency: row.currency,
      receivedAt,
      packageName: REVOLUT_PACKAGE_NAME,
      isCash: false,
      isIncome,
      isDeleted: false,
    });

    addTransaction(db, txData);
    imported++;
  }

  return { imported, skipped };
}
