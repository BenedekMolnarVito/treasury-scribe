/**
 * RevolutImportService.test.ts
 *
 * Comprehensive tests for the Revolut CSV import service.  Each test gets
 * its own isolated in-memory sql.js database.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import {
  importRevolutCsv,
  type RevolutImportSummary,
} from "../../src/services/RevolutImportService";
import {
  addTransaction,
  getAllTransactions,
  getAllTransactionsIncludingDeleted,
} from "../../src/data/TransactionRepository";
import { getTagsForTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";

// ---------------------------------------------------------------------------
// WASM setup
// ---------------------------------------------------------------------------

const WASM_PATH = resolve(
  __dirname,
  "../../node_modules/sql.js/dist/sql-wasm.wasm"
);

let wasmBinary: ArrayBuffer;

beforeAll(async () => {
  wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
});

// ---------------------------------------------------------------------------
// Per-test database lifecycle
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(async () => {
  db = await initDatabase(wasmBinary);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// CSV test helpers
// ---------------------------------------------------------------------------

const CSV_HEADER =
  "Típus,Termék,Kezdés dátuma,Teljesítés dátuma,Leírás,Összeg,Díj,Pénznem,State,Egyenleg";

function buildCsv(...dataRows: string[]): string {
  return [CSV_HEADER, ...dataRows].join("\n");
}

const CARD_PAYMENT_ROW =
  "Kártyás fizetés,Folyószámla,2026-01-31 12:21:56,2026-02-01 14:53:26,Shell,-200.00,0.00,HUF,ELVÉGEZVE,78226.50";

const TRANSFER_EXPENSE_ROW =
  "Átutalás,Folyószámla,2026-02-02 12:54:50,2026-02-02 13:19:07,SWIFT-átutalás,-50000.00,0.00,HUF,ELVÉGEZVE,64557.50";

const TRANSFER_INCOME_ROW =
  "Átutalás,Folyószámla,2026-02-03 17:16:06,2026-02-03 17:16:06,Átutalás tőle: Aniko,50000.00,0.00,HUF,ELVÉGEZVE,108411.10";

const TOPUP_ROW =
  "Feltöltés,Folyószámla,2026-02-02 12:54:51,2026-02-02 12:54:52,Feltöltés 0874,40000.00,0.00,HUF,ELVÉGEZVE,114557.50";

const EXCHANGE_ROW =
  "Átváltás,Folyószámla,2026-02-02 13:03:05,2026-02-02 13:03:05,Átváltva erre: EUR,-200000.00,0.00,HUF,ELVÉGEZVE,114557.50";

const REFUND_ROW =
  "Kártyás visszatérítés,Folyószámla,2026-03-12 01:00:00,2026-03-12 14:51:25,OBI,5749.00,0.00,HUF,ELVÉGEZVE,60212.86";

const PENDING_ROW =
  "Kártyás fizetés,Folyószámla,2026-03-19 10:57:45,,Booking.com,-4350.00,0.00,HUF,FÜGGŐBEN LÉVŐ,";

// ---------------------------------------------------------------------------
// 1. Basic parsing
// ---------------------------------------------------------------------------

describe("importRevolutCsv – CSV parsing", () => {
  it("parses valid Revolut CSV with Hungarian headers", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW, TOPUP_ROW);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(2);
    const txs = getAllTransactions(db);
    expect(txs).toHaveLength(2);
  });

  it("handles BOM in CSV", () => {
    const csvWithBom = "\uFEFF" + buildCsv(CARD_PAYMENT_ROW);

    const summary = importRevolutCsv(db, csvWithBom);

    expect(summary.imported).toBe(1);
    const txs = getAllTransactions(db);
    expect(txs).toHaveLength(1);
    expect(txs[0].notificationTitle).toBe("Shell");
  });

  it("handles empty CSV string", () => {
    const summary = importRevolutCsv(db, "");

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("handles CSV with only headers (no data rows)", () => {
    const summary = importRevolutCsv(db, CSV_HEADER);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("handles malformed rows gracefully (skips without crashing)", () => {
    const malformedRow = "bad,data";
    const csv = buildCsv(CARD_PAYMENT_ROW, malformedRow, TOPUP_ROW);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBe(1);
  });

  it("handles rows with unparseable amounts", () => {
    const badAmountRow =
      "Kártyás fizetés,Folyószámla,2026-01-31 12:21:56,2026-02-01 14:53:26,Test,NOT_A_NUMBER,0.00,HUF,ELVÉGEZVE,78226.50";
    const csv = buildCsv(badAmountRow);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("imports pending transactions (FÜGGŐBEN LÉVŐ)", () => {
    const csv = buildCsv(PENDING_ROW);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
    const txs = getAllTransactions(db);
    expect(txs[0].notificationTitle).toBe("Booking.com");
  });

  it("handles CRLF line endings", () => {
    const csv = [CSV_HEADER, CARD_PAYMENT_ROW].join("\r\n");

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Field mapping
// ---------------------------------------------------------------------------

describe("importRevolutCsv – field mapping", () => {
  it("maps notificationTitle to Leírás (vendor description)", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.notificationTitle).toBe("Shell");
  });

  it("maps notificationBody to Típus: Leírás", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.notificationBody).toBe("Kártyás fizetés: Shell");
  });

  it("maps amount to absolute value of Összeg", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.amount).toBe(200);
  });

  it("maps currency to Pénznem", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.currency).toBe("HUF");
  });

  it("maps receivedAt to ISO 8601 from Kezdés dátuma", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.receivedAt).toBe("2026-01-31T12:21:56");
  });

  it("sets packageName to com.revolut.revolut", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.packageName).toBe("com.revolut.revolut");
  });

  it("sets isCash to false", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isCash).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Income / expense classification
// ---------------------------------------------------------------------------

describe("importRevolutCsv – income and expense classification", () => {
  it("maps card payments (negative amount) as expenses", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isIncome).toBe(false);
    expect(tx.amount).toBe(200);
  });

  it("maps transfers with negative amount as expenses", () => {
    const csv = buildCsv(TRANSFER_EXPENSE_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isIncome).toBe(false);
    expect(tx.amount).toBe(50000);
  });

  it("maps transfers with positive amount as income", () => {
    const csv = buildCsv(TRANSFER_INCOME_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isIncome).toBe(true);
    expect(tx.amount).toBe(50000);
  });

  it("maps top-ups as income", () => {
    const csv = buildCsv(TOPUP_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isIncome).toBe(true);
    expect(tx.amount).toBe(40000);
  });

  it("maps refunds as income", () => {
    const csv = buildCsv(REFUND_ROW);
    importRevolutCsv(db, csv);

    const tx = getAllTransactions(db)[0];
    expect(tx.isIncome).toBe(true);
    expect(tx.amount).toBe(5749);
  });
});

// ---------------------------------------------------------------------------
// 4. Skipping
// ---------------------------------------------------------------------------

describe("importRevolutCsv – type filtering", () => {
  it("skips currency exchanges (Átváltás)", () => {
    const csv = buildCsv(EXCHANGE_ROW, CARD_PAYMENT_ROW);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);

    const txs = getAllTransactions(db);
    expect(txs).toHaveLength(1);
    expect(txs[0].notificationTitle).toBe("Shell");
  });

  it("skips unknown types", () => {
    const unknownRow =
      "Ismeretlen,Folyószámla,2026-01-31 12:21:56,2026-02-01 14:53:26,Test,-100.00,0.00,HUF,ELVÉGEZVE,78226.50";
    const csv = buildCsv(unknownRow);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Deduplication
// ---------------------------------------------------------------------------

describe("importRevolutCsv – deduplication", () => {
  it("skips rows that match an existing transaction (same vendor, amount, date)", () => {
    // Pre-insert a transaction matching the CSV row
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Shell",
        amount: 200,
        receivedAt: "2026-01-31T12:21:56",
        packageName: "com.revolut.revolut",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("deduplicates within ±1 day window", () => {
    // Pre-insert with timestamp 12 hours earlier (within 1 day)
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Shell",
        amount: 200,
        receivedAt: "2026-01-31T00:21:56",
        packageName: "com.revolut.revolut",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("does NOT deduplicate when date differs by more than 1 day", () => {
    // Pre-insert with timestamp 2 days earlier (outside window)
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Shell",
        amount: 200,
        receivedAt: "2026-01-29T12:21:56",
        packageName: "com.revolut.revolut",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
  });

  it("does NOT deduplicate when amount differs", () => {
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Shell",
        amount: 999,
        receivedAt: "2026-01-31T12:21:56",
        packageName: "com.revolut.revolut",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
  });

  it("skips duplicate when importing same CSV twice", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW, TOPUP_ROW);

    const first = importRevolutCsv(db, csv);
    expect(first.imported).toBe(2);

    const second = importRevolutCsv(db, csv);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);

    expect(getAllTransactions(db)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Non-destructive behaviour
// ---------------------------------------------------------------------------

describe("importRevolutCsv – does NOT delete existing transactions", () => {
  it("preserves pre-existing transactions after import", () => {
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Pre-existing vendor",
        notificationBody: "Pre-existing body",
        receivedAt: "2024-06-01T10:00:00",
        amount: 42,
        currency: "EUR",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const allTxs = getAllTransactions(db);
    expect(allTxs).toHaveLength(2);

    const preserved = allTxs.find((t) => t.id === existing.id);
    expect(preserved).toBeDefined();
    expect(preserved!.notificationTitle).toBe("Pre-existing vendor");
  });

  it("preserves soft-deleted transactions after import", () => {
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Deleted vendor",
        receivedAt: "2024-06-01T10:00:00",
        isDeleted: true,
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const allTxs = getAllTransactionsIncludingDeleted(db);
    const preserved = allTxs.find((t) => t.id === existing.id);
    expect(preserved).toBeDefined();
    expect(preserved!.isDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Tagging
// ---------------------------------------------------------------------------

describe("importRevolutCsv – tagging", () => {
  it("tags all imported transactions with RevolutImport", () => {
    const csv = buildCsv(CARD_PAYMENT_ROW, TOPUP_ROW, REFUND_ROW);
    importRevolutCsv(db, csv);

    const txs = getAllTransactions(db);
    for (const tx of txs) {
      const tags = getTagsForTransaction(db, tx.id);
      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain("RevolutImport");
    }
  });

  it("does NOT tag skipped transactions (exchanges)", () => {
    const csv = buildCsv(EXCHANGE_ROW);
    importRevolutCsv(db, csv);

    const txs = getAllTransactions(db);
    expect(txs).toHaveLength(0);
  });

  it("does NOT tag pre-existing transactions with RevolutImport", () => {
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Untagged vendor",
        receivedAt: "2024-06-01T10:00:00",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW);
    importRevolutCsv(db, csv);

    const existingTags = getTagsForTransaction(db, existing.id);
    const tagNames = existingTags.map((t) => t.name);
    expect(tagNames).not.toContain("RevolutImport");
  });
});

// ---------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------

describe("importRevolutCsv – summary", () => {
  it("returns correct imported and skipped counts", () => {
    const csv = buildCsv(
      CARD_PAYMENT_ROW,
      EXCHANGE_ROW,
      TOPUP_ROW,
      TRANSFER_EXPENSE_ROW,
      REFUND_ROW
    );

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(4);
    expect(summary.skipped).toBe(1);
  });

  it("counts malformed rows as skipped", () => {
    const csv = buildCsv("incomplete,row", CARD_PAYMENT_ROW);

    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it("counts duplicates as skipped", () => {
    addTransaction(
      db,
      createTransaction({
        notificationTitle: "Shell",
        amount: 200,
        receivedAt: "2026-01-31T12:21:56",
      })
    );

    const csv = buildCsv(CARD_PAYMENT_ROW, TOPUP_ROW);
    const summary = importRevolutCsv(db, csv);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Real-world CSV template
// ---------------------------------------------------------------------------

describe("importRevolutCsv – real CSV template file", () => {
  it("imports the account-statement CSV from tests folder", () => {
    const csvPath = resolve(__dirname, "../account-statement_2026-02-01_2026-03-22_hu-hu_5138f3.csv");
    const csvContent = readFileSync(csvPath, "utf-8");

    const summary = importRevolutCsv(db, csvContent);

    // Account statement: 98 data rows, 6 Átváltás (skip)
    expect(summary.imported).toBeGreaterThan(0);
    expect(summary.imported + summary.skipped).toBe(98);
    expect(summary.skipped).toBeGreaterThanOrEqual(6);
    expect(summary.imported).toBe(98 - summary.skipped);

    const allTxs = getAllTransactions(db);
    expect(allTxs.length).toBe(summary.imported);

    // Verify every imported tx is tagged
    for (const tx of allTxs) {
      const tags = getTagsForTransaction(db, tx.id);
      expect(tags.map((t) => t.name)).toContain("RevolutImport");
    }
  });
});
