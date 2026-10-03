/**
 * ImportService.test.ts
 *
 * Unit / integration tests for the CSV and JSON import functions in
 * ImportService. Each test gets its own isolated in-memory database.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import {
  importFromCSV,
  importFromJSON,
  importTransactions,
} from "../../src/services/ImportService";
import {
  getAllTransactions,
  getAllTransactionsIncludingDeleted,
} from "../../src/data/TransactionRepository";
import { getTagsForTransaction } from "../../src/data/TagRepository";

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

async function makeDb(): Promise<Database> {
  return initDatabase(wasmBinary);
}

// ---------------------------------------------------------------------------
// Per-test database lifecycle
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(async () => {
  db = await makeDb();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const CSV_HEADERS =
  "Id,ReceivedAt,NotificationTitle,NotificationBody,PackageName,Amount,Currency,IsCash,Tags,IsDeleted";

function csvLine(
  id: number,
  receivedAt: string,
  title: string,
  body: string,
  pkg: string,
  amount: number,
  currency: string,
  isCash: 0 | 1,
  tags: string,
  isDeleted: 0 | 1
): string {
  return [id, receivedAt, title, body, pkg, amount, currency, isCash, tags, isDeleted].join(",");
}

const SAMPLE_ROW_1 = csvLine(
  1,
  "2026-01-15T10:00:00.000Z",
  "Shell",
  "Card payment",
  "com.revolut.revolut",
  200,
  "HUF",
  0,
  "Food;Transport",
  0
);

const SAMPLE_ROW_2 = csvLine(
  2,
  "2026-01-16T12:00:00.000Z",
  "Tesco",
  "Groceries",
  "com.revolut.revolut",
  5000,
  "HUF",
  0,
  "Shopping",
  0
);

const SAMPLE_JSON = JSON.stringify([
  {
    Id: 1,
    ReceivedAt: "2026-01-15T10:00:00.000Z",
    NotificationTitle: "Shell",
    NotificationBody: "Card payment",
    PackageName: "com.revolut.revolut",
    Amount: 200,
    Currency: "HUF",
    IsCash: 0,
    Tags: "Food;Transport",
    IsDeleted: 0,
  },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tagNames(db: Database, transactionId: number): string[] {
  return getTagsForTransaction(db, transactionId).map((t) => t.name);
}

// ---------------------------------------------------------------------------
// importFromCSV
// ---------------------------------------------------------------------------

describe("importFromCSV", () => {
  it("parses valid CSV correctly", () => {
    const csv = [CSV_HEADERS, SAMPLE_ROW_1, SAMPLE_ROW_2].join("\n");
    const result = importFromCSV(db, csv);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("creates transactions with correct fields", () => {
    const csv = [CSV_HEADERS, SAMPLE_ROW_1].join("\n");
    importFromCSV(db, csv);

    const transactions = getAllTransactions(db);
    expect(transactions).toHaveLength(1);

    const tx = transactions[0]!;
    expect(tx.receivedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(tx.notificationTitle).toBe("Shell");
    expect(tx.notificationBody).toBe("Card payment");
    expect(tx.packageName).toBe("com.revolut.revolut");
    expect(tx.amount).toBe(200);
    expect(tx.currency).toBe("HUF");
    expect(tx.isCash).toBe(false);
    expect(tx.isDeleted).toBe(false);
  });

  it("re-creates tags from semicolon-separated list", () => {
    const csv = [CSV_HEADERS, SAMPLE_ROW_1].join("\n");
    importFromCSV(db, csv);

    const transactions = getAllTransactions(db);
    const tags = tagNames(db, transactions[0]!.id);
    expect(tags).toContain("Food");
    expect(tags).toContain("Transport");
  });



  it("skips duplicate transactions", () => {
    // Import once
    const csv = [CSV_HEADERS, SAMPLE_ROW_1].join("\n");
    importFromCSV(db, csv);

    // Import again — same content should be detected as duplicate
    const result = importFromCSV(db, csv);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);

    const transactions = getAllTransactions(db);
    expect(transactions).toHaveLength(1);
  });

  it("imports IsDeleted=1 rows and soft-deletes them", () => {
    const deletedRow = csvLine(
      3,
      "2026-02-01T08:00:00.000Z",
      "DeletedVendor",
      "Deleted body",
      "com.app",
      100,
      "EUR",
      0,
      "",
      1
    );
    const csv = [CSV_HEADERS, deletedRow].join("\n");
    const result = importFromCSV(db, csv);

    // The row must be imported (count=1), not skipped.
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    // The row is hidden from the regular view (isDeleted=0 filter).
    expect(getAllTransactions(db)).toHaveLength(0);
    // But it exists when we include deleted rows.
    const allRows = getAllTransactionsIncludingDeleted(db);
    expect(allRows).toHaveLength(1);
    expect(allRows[0]!.isDeleted).toBe(true);
    expect(allRows[0]!.notificationTitle).toBe("DeletedVendor");
  });

  it("handles empty CSV (headers only)", () => {
    const result = importFromCSV(db, CSV_HEADERS);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles malformed rows gracefully", () => {
    const badRow = "only,three,columns";
    const csv = [CSV_HEADERS, SAMPLE_ROW_1, badRow].join("\n");
    const result = importFromCSV(db, csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Row 2");
  });

  it("handles CSV with quoted fields", () => {
    // Title has embedded comma; body has embedded double-quotes (CSV "" escaping)
    const quotedRow =
      '4,2026-03-01T09:00:00.000Z,"Vendor, Inc.","""Big""  purchase",com.app,300,EUR,1,,0';
    const csv = [CSV_HEADERS, quotedRow].join("\n");
    const result = importFromCSV(db, csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);

    const transactions = getAllTransactions(db);
    const tx = transactions[0]!;
    expect(tx.notificationTitle).toBe("Vendor, Inc.");
    expect(tx.notificationBody).toBe('"Big"  purchase');
    expect(tx.isCash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// importFromJSON
// ---------------------------------------------------------------------------

describe("importFromJSON", () => {
  it("parses valid JSON array", () => {
    const result = importFromJSON(db, SAMPLE_JSON);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("creates transactions with correct fields", () => {
    importFromJSON(db, SAMPLE_JSON);

    const transactions = getAllTransactions(db);
    expect(transactions).toHaveLength(1);

    const tx = transactions[0]!;
    expect(tx.receivedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(tx.notificationTitle).toBe("Shell");
    expect(tx.notificationBody).toBe("Card payment");
    expect(tx.packageName).toBe("com.revolut.revolut");
    expect(tx.amount).toBe(200);
    expect(tx.currency).toBe("HUF");
    expect(tx.isCash).toBe(false);
  });

  it("re-creates tags", () => {
    importFromJSON(db, SAMPLE_JSON);

    const transactions = getAllTransactions(db);
    const tags = tagNames(db, transactions[0]!.id);
    expect(tags).toContain("Food");
    expect(tags).toContain("Transport");
  });

  it("skips duplicates", () => {
    importFromJSON(db, SAMPLE_JSON);
    const result = importFromJSON(db, SAMPLE_JSON);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getAllTransactions(db)).toHaveLength(1);
  });

  it("handles empty array", () => {
    const result = importFromJSON(db, "[]");

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles malformed JSON gracefully", () => {
    const result = importFromJSON(db, "not valid json");

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Invalid JSON");
  });

  it("handles JSON items missing required fields", () => {
    const badJson = JSON.stringify([{ Id: 1, Amount: 100 }]);
    const result = importFromJSON(db, badJson);

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Item 0");
  });

  it("imports IsDeleted=1 rows in JSON and soft-deletes them", () => {
    const jsonWithDeleted = JSON.stringify([
      {
        Id: 5,
        ReceivedAt: "2026-02-01T08:00:00.000Z",
        NotificationTitle: "Deleted",
        NotificationBody: "Deleted body",
        PackageName: "com.app",
        Amount: 100,
        Currency: "EUR",
        IsCash: 0,
        Tags: "",
        IsDeleted: 1,
      },
    ]);
    const result = importFromJSON(db, jsonWithDeleted);

    // The row must be imported (count=1), not skipped.
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    // The row is hidden from the regular view.
    expect(getAllTransactions(db)).toHaveLength(0);
    // But it exists when we include deleted rows.
    const allRows = getAllTransactionsIncludingDeleted(db);
    expect(allRows).toHaveLength(1);
    expect(allRows[0]!.isDeleted).toBe(true);
    expect(allRows[0]!.notificationTitle).toBe("Deleted");
  });
});

// ---------------------------------------------------------------------------
// importTransactions (auto-detect)
// ---------------------------------------------------------------------------

describe("importTransactions", () => {
  it("auto-detects CSV format", () => {
    const csv = [CSV_HEADERS, SAMPLE_ROW_1].join("\n");
    const result = importTransactions(db, csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("auto-detects JSON format", () => {
    const result = importTransactions(db, SAMPLE_JSON);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("auto-detects JSON even with leading whitespace", () => {
    const result = importTransactions(db, "  \n" + SAMPLE_JSON);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: export (with deleted) → re-import → hidden in fresh DB
// ---------------------------------------------------------------------------

describe("IsDeleted round-trip (export → import)", () => {
  it("a soft-deleted row is hidden after re-import into a fresh DB", async () => {
    // Simulate an export file that contains a deleted row (IsDeleted=1).
    // This is what the fixed export will produce after FR5.
    const exportedCsv = [
      CSV_HEADERS,
      // Non-deleted row
      csvLine(1, "2026-03-01T09:00:00.000Z", "ActiveVendor", "Active body", "com.app", 500, "HUF", 0, "", 0),
      // Deleted row
      csvLine(2, "2026-03-02T10:00:00.000Z", "GoneVendor", "Gone body", "com.app", 999, "HUF", 0, "OldTag", 1),
    ].join("\n");

    // Re-import into a fresh DB (db is reset per test via beforeEach).
    const result = importFromCSV(db, exportedCsv);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Active row visible in normal view.
    const visible = getAllTransactions(db);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.notificationTitle).toBe("ActiveVendor");

    // Deleted row hidden from normal view but present when including deleted.
    const all = getAllTransactionsIncludingDeleted(db);
    expect(all).toHaveLength(2);
    const gone = all.find((t) => t.notificationTitle === "GoneVendor");
    expect(gone).toBeDefined();
    expect(gone!.isDeleted).toBe(true);

    // Tags on the deleted row are still re-created.
    const tags = tagNames(db, gone!.id);
    expect(tags).toContain("OldTag");
  });
});

// ---------------------------------------------------------------------------
// FIX 1 (I-2): ExcludeFromAutoLearn round-trip in ImportService
// ---------------------------------------------------------------------------

describe("FIX I-2 – ExcludeFromAutoLearn import (CSV)", () => {
  const NEW_CSV_HEADERS =
    "Id,ReceivedAt,NotificationTitle,NotificationBody,PackageName,Amount,Currency,IsCash,Tags,IsDeleted,ExcludeFromAutoLearn";

  it("(a) new-format row with ExcludeFromAutoLearn=1 imports with flag=true", () => {
    const row11Col = "1,2026-01-15T10:00:00.000Z,Shell,Card payment,com.revolut.revolut,200,HUF,0,,0,1";
    const csv = [NEW_CSV_HEADERS, row11Col].join("\n");
    importFromCSV(db, csv);

    const txs = getAllTransactionsIncludingDeleted(db);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.excludeFromAutoLearn).toBe(true);
  });

  it("(b) old-format 10-column row still imports fine with flag defaulting to false (backward-compat)", () => {
    const OLD_HEADERS = "Id,ReceivedAt,NotificationTitle,NotificationBody,PackageName,Amount,Currency,IsCash,Tags,IsDeleted";
    const row10Col = "1,2026-01-15T10:00:00.000Z,Shell,Card payment,com.revolut.revolut,200,HUF,0,,0";
    const csv = [OLD_HEADERS, row10Col].join("\n");
    const result = importFromCSV(db, csv);

    expect(result.errors).toHaveLength(0);
    expect(result.imported).toBe(1);

    const txs = getAllTransactionsIncludingDeleted(db);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.excludeFromAutoLearn).toBe(false);
  });

  it("(c) a row with ExcludeFromAutoLearn=0 in new-format imports with flag=false", () => {
    const row11Col = "1,2026-01-15T10:00:00.000Z,Shell,Card payment,com.revolut.revolut,200,HUF,0,,0,0";
    const csv = [NEW_CSV_HEADERS, row11Col].join("\n");
    importFromCSV(db, csv);

    const txs = getAllTransactionsIncludingDeleted(db);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.excludeFromAutoLearn).toBe(false);
  });

  it("genuinely malformed row (< 10 columns) still gets an error", () => {
    const csv = [NEW_CSV_HEADERS, "only,three,columns"].join("\n");
    const result = importFromCSV(db, csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Row 1");
  });
});

describe("FIX I-2 – ExcludeFromAutoLearn import (JSON)", () => {
  it("(a) JSON row with ExcludeFromAutoLearn=1 imports with flag=true", () => {
    const json = JSON.stringify([
      {
        Id: 1,
        ReceivedAt: "2026-01-15T10:00:00.000Z",
        NotificationTitle: "Shell",
        NotificationBody: "Card payment",
        PackageName: "com.revolut.revolut",
        Amount: 200,
        Currency: "HUF",
        IsCash: 0,
        Tags: "",
        IsDeleted: 0,
        ExcludeFromAutoLearn: 1,
      },
    ]);
    importFromJSON(db, json);

    const txs = getAllTransactionsIncludingDeleted(db);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.excludeFromAutoLearn).toBe(true);
  });

  it("(b) JSON row without ExcludeFromAutoLearn field imports with flag=false (backward-compat)", () => {
    const json = JSON.stringify([
      {
        Id: 1,
        ReceivedAt: "2026-01-15T10:00:00.000Z",
        NotificationTitle: "Shell",
        NotificationBody: "Card payment",
        PackageName: "com.revolut.revolut",
        Amount: 200,
        Currency: "HUF",
        IsCash: 0,
        Tags: "",
        IsDeleted: 0,
        // No ExcludeFromAutoLearn field
      },
    ]);
    const result = importFromJSON(db, json);

    expect(result.errors).toHaveLength(0);
    const txs = getAllTransactionsIncludingDeleted(db);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.excludeFromAutoLearn).toBe(false);
  });
});
