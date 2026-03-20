/**
 * DashboardRepository.test.ts
 *
 * Integration tests for DashboardRepository using a real in-memory sql.js
 * database.  Each test gets a fresh database via beforeEach / afterEach so
 * there is no shared state between test cases.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import { initDatabase } from "../../src/data/DatabaseService";
import {
  getSpendingByTag,
  getSpendingByMonth,
  getSpendingByVendor,
  getSpendingSummary,
  getUntaggedTransactionCount,
} from "../../src/data/DashboardRepository";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const WASM_PATH = resolve(
  __dirname,
  "../../node_modules/sql.js/dist/sql-wasm.wasm"
);

let wasmBinary: ArrayBuffer;
let db: Database;

beforeEach(async () => {
  if (!wasmBinary) {
    wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
  }
  db = await initDatabase(wasmBinary);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inserts a transaction row and returns its new id. */
function insertTransaction(overrides: {
  receivedAt?: string;
  notificationTitle?: string;
  amount?: number | null;
  isIncome?: boolean;
  isDeleted?: boolean;
} = {}): number {
  const receivedAt = overrides.receivedAt ?? "2024-06-15T10:00:00.000Z";
  const title = overrides.notificationTitle ?? "Revolut";
  const amount = overrides.amount ?? 10;
  const isIncome = overrides.isIncome ? 1 : 0;
  const isDeleted = overrides.isDeleted ? 1 : 0;

  db.run(
    `INSERT INTO Transactions
       (ReceivedAt, NotificationTitle, Amount, Currency, IsIncome, IsDeleted, IsCash)
     VALUES (?, ?, ?, 'EUR', ?, ?, 0)`,
    [receivedAt, title, amount, isIncome, isDeleted]
  );
  const rows = db.exec("SELECT last_insert_rowid() AS id");
  return rows[0].values[0][0] as number;
}

/** Inserts a tag and returns its id. */
function insertTag(name: string): number {
  db.run(
    "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, '2024-01-01T00:00:00.000Z')",
    [name]
  );
  const rows = db.exec("SELECT last_insert_rowid() AS id");
  return rows[0].values[0][0] as number;
}

/** Links a transaction to a tag. */
function linkTag(transactionId: number, tagId: number): void {
  db.run(
    "INSERT OR IGNORE INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')",
    [transactionId, tagId]
  );
}

// ---------------------------------------------------------------------------
// getSpendingByTag
// ---------------------------------------------------------------------------

describe("getSpendingByTag", () => {
  it("returns empty array on an empty database", () => {
    expect(getSpendingByTag(db)).toEqual([]);
  });

  it("groups spending by tag name ordered by total DESC", () => {
    const foodTag = insertTag("food");
    const travelTag = insertTag("travel");

    const tx1 = insertTransaction({ amount: 50 });
    const tx2 = insertTransaction({ amount: 30 });
    const tx3 = insertTransaction({ amount: 20 });

    linkTag(tx1, foodTag);
    linkTag(tx2, foodTag);
    linkTag(tx3, travelTag);

    const results = getSpendingByTag(db);
    expect(results[0].tagName).toBe("food");
    expect(results[0].total).toBe(80);
    expect(results[0].count).toBe(2);
    expect(results[1].tagName).toBe("travel");
    expect(results[1].total).toBe(20);
    expect(results[1].count).toBe(1);
  });

  it("includes an Untagged entry for transactions with no tags", () => {
    const foodTag = insertTag("food");
    const tx1 = insertTransaction({ amount: 25 });
    linkTag(tx1, foodTag);

    // Untagged transaction
    insertTransaction({ amount: 15 });

    const results = getSpendingByTag(db);
    const untagged = results.find((r) => r.tagName === "Untagged");
    expect(untagged).toBeDefined();
    expect(untagged!.total).toBe(15);
    expect(untagged!.count).toBe(1);
  });

  it("does not include Untagged when all transactions have tags", () => {
    const tag = insertTag("food");
    const tx = insertTransaction({ amount: 10 });
    linkTag(tx, tag);

    const results = getSpendingByTag(db);
    expect(results.find((r) => r.tagName === "Untagged")).toBeUndefined();
  });

  it("respects startDate filter", () => {
    const tag = insertTag("food");
    const txOld = insertTransaction({
      amount: 100,
      receivedAt: "2024-01-01T10:00:00.000Z",
    });
    const txNew = insertTransaction({
      amount: 40,
      receivedAt: "2024-06-15T10:00:00.000Z",
    });
    linkTag(txOld, tag);
    linkTag(txNew, tag);

    const results = getSpendingByTag(db, "2024-06-01T00:00:00.000Z");
    expect(results).toHaveLength(1);
    expect(results[0].total).toBe(40);
  });

  it("respects endDate filter", () => {
    const tag = insertTag("food");
    const txOld = insertTransaction({
      amount: 100,
      receivedAt: "2024-01-01T10:00:00.000Z",
    });
    const txNew = insertTransaction({
      amount: 40,
      receivedAt: "2024-06-15T10:00:00.000Z",
    });
    linkTag(txOld, tag);
    linkTag(txNew, tag);

    const results = getSpendingByTag(
      db,
      undefined,
      "2024-02-01T00:00:00.000Z"
    );
    expect(results).toHaveLength(1);
    expect(results[0].total).toBe(100);
  });

  it("excludes deleted transactions", () => {
    const tag = insertTag("food");
    const txActive = insertTransaction({ amount: 20 });
    const txDeleted = insertTransaction({ amount: 100, isDeleted: true });
    linkTag(txActive, tag);
    linkTag(txDeleted, tag);

    const results = getSpendingByTag(db);
    expect(results).toHaveLength(1);
    expect(results[0].total).toBe(20);
  });

  it("excludes income transactions", () => {
    const tag = insertTag("salary");
    const txExpense = insertTransaction({ amount: 10 });
    const txIncome = insertTransaction({ amount: 5000, isIncome: true });
    linkTag(txExpense, tag);
    linkTag(txIncome, tag);

    const results = getSpendingByTag(db);
    expect(results).toHaveLength(1);
    expect(results[0].total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getSpendingByMonth
// ---------------------------------------------------------------------------

describe("getSpendingByMonth", () => {
  it("returns empty array on an empty database", () => {
    expect(getSpendingByMonth(db)).toEqual([]);
  });

  it("groups spending by YYYY-MM in chronological order", () => {
    insertTransaction({
      amount: 50,
      receivedAt: "2024-01-15T10:00:00.000Z",
    });
    insertTransaction({
      amount: 30,
      receivedAt: "2024-01-20T10:00:00.000Z",
    });
    insertTransaction({
      amount: 20,
      receivedAt: "2024-03-10T10:00:00.000Z",
    });

    const results = getSpendingByMonth(db, 120);
    expect(results.length).toBeGreaterThanOrEqual(2);

    const jan = results.find((r) => r.month === "2024-01");
    const mar = results.find((r) => r.month === "2024-03");
    expect(jan).toBeDefined();
    expect(jan!.total).toBe(80);
    expect(jan!.count).toBe(2);
    expect(mar).toBeDefined();
    expect(mar!.total).toBe(20);
    expect(mar!.count).toBe(1);

    // Chronological order
    const janIdx = results.indexOf(jan!);
    const marIdx = results.indexOf(mar!);
    expect(janIdx).toBeLessThan(marIdx);
  });

  it("respects the months limit", () => {
    // Insert a very old transaction outside any reasonable window
    insertTransaction({
      amount: 99,
      receivedAt: "2000-01-01T10:00:00.000Z",
    });
    // Insert a recent one
    insertTransaction({
      amount: 10,
      receivedAt: new Date().toISOString(),
    });

    const results = getSpendingByMonth(db, 1);
    // The 2000 transaction should be excluded
    expect(results.find((r) => r.month === "2000-01")).toBeUndefined();
  });

  it("excludes deleted transactions", () => {
    const now = new Date().toISOString();
    insertTransaction({ amount: 50, receivedAt: now });
    insertTransaction({ amount: 100, receivedAt: now, isDeleted: true });

    const results = getSpendingByMonth(db, 1);
    const total = results.reduce((sum, r) => sum + r.total, 0);
    expect(total).toBe(50);
  });

  it("excludes income transactions", () => {
    const now = new Date().toISOString();
    insertTransaction({ amount: 30, receivedAt: now });
    insertTransaction({ amount: 500, receivedAt: now, isIncome: true });

    const results = getSpendingByMonth(db, 1);
    const total = results.reduce((sum, r) => sum + r.total, 0);
    expect(total).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// getSpendingByVendor
// ---------------------------------------------------------------------------

describe("getSpendingByVendor", () => {
  it("returns empty array on an empty database", () => {
    expect(getSpendingByVendor(db)).toEqual([]);
  });

  it("groups spending by vendor ordered by total DESC", () => {
    insertTransaction({ amount: 50, notificationTitle: "Lidl" });
    insertTransaction({ amount: 30, notificationTitle: "Lidl" });
    insertTransaction({ amount: 70, notificationTitle: "Aldi" });

    const results = getSpendingByVendor(db);
    expect(results[0].vendor).toBe("Lidl");
    expect(results[0].total).toBe(80);
    expect(results[0].count).toBe(2);
    expect(results[1].vendor).toBe("Aldi");
    expect(results[1].total).toBe(70);
    expect(results[1].count).toBe(1);
  });

  it("respects the limit parameter", () => {
    insertTransaction({ amount: 50, notificationTitle: "VendorA" });
    insertTransaction({ amount: 40, notificationTitle: "VendorB" });
    insertTransaction({ amount: 30, notificationTitle: "VendorC" });

    const results = getSpendingByVendor(db, 2);
    expect(results).toHaveLength(2);
    expect(results[0].vendor).toBe("VendorA");
    expect(results[1].vendor).toBe("VendorB");
  });

  it("respects date range filters", () => {
    insertTransaction({
      amount: 100,
      notificationTitle: "Lidl",
      receivedAt: "2024-01-10T10:00:00.000Z",
    });
    insertTransaction({
      amount: 25,
      notificationTitle: "Lidl",
      receivedAt: "2024-06-10T10:00:00.000Z",
    });

    const results = getSpendingByVendor(
      db,
      10,
      "2024-06-01T00:00:00.000Z"
    );
    expect(results).toHaveLength(1);
    expect(results[0].total).toBe(25);
  });

  it("excludes deleted transactions", () => {
    insertTransaction({ amount: 50, notificationTitle: "Lidl" });
    insertTransaction({
      amount: 200,
      notificationTitle: "Lidl",
      isDeleted: true,
    });

    const results = getSpendingByVendor(db);
    expect(results[0].total).toBe(50);
  });

  it("excludes income transactions", () => {
    insertTransaction({ amount: 50, notificationTitle: "Lidl" });
    insertTransaction({
      amount: 1000,
      notificationTitle: "Employer",
      isIncome: true,
    });

    const results = getSpendingByVendor(db);
    expect(results).toHaveLength(1);
    expect(results[0].vendor).toBe("Lidl");
  });

  it("uses Unknown for null vendor titles", () => {
    db.run(
      `INSERT INTO Transactions
         (ReceivedAt, NotificationTitle, Amount, Currency, IsIncome, IsDeleted, IsCash)
       VALUES ('2024-06-15T10:00:00.000Z', NULL, 10, 'EUR', 0, 0, 0)`
    );

    const results = getSpendingByVendor(db);
    expect(results[0].vendor).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// getSpendingSummary
// ---------------------------------------------------------------------------

describe("getSpendingSummary", () => {
  it("returns zeroes on an empty database", () => {
    const summary = getSpendingSummary(db);
    expect(summary.total).toBe(0);
    expect(summary.count).toBe(0);
    expect(summary.avgPerTransaction).toBe(0);
  });

  it("computes correct total, count, and average", () => {
    insertTransaction({ amount: 30 });
    insertTransaction({ amount: 60 });
    insertTransaction({ amount: 90 });

    const summary = getSpendingSummary(db);
    expect(summary.total).toBe(180);
    expect(summary.count).toBe(3);
    expect(summary.avgPerTransaction).toBe(60);
  });

  it("respects date range filters", () => {
    insertTransaction({
      amount: 100,
      receivedAt: "2024-01-01T10:00:00.000Z",
    });
    insertTransaction({
      amount: 50,
      receivedAt: "2024-06-15T10:00:00.000Z",
    });

    const summary = getSpendingSummary(db, "2024-06-01T00:00:00.000Z");
    expect(summary.total).toBe(50);
    expect(summary.count).toBe(1);
    expect(summary.avgPerTransaction).toBe(50);
  });

  it("excludes deleted transactions", () => {
    insertTransaction({ amount: 40 });
    insertTransaction({ amount: 200, isDeleted: true });

    const summary = getSpendingSummary(db);
    expect(summary.total).toBe(40);
    expect(summary.count).toBe(1);
  });

  it("excludes income transactions", () => {
    insertTransaction({ amount: 25 });
    insertTransaction({ amount: 5000, isIncome: true });

    const summary = getSpendingSummary(db);
    expect(summary.total).toBe(25);
    expect(summary.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getUntaggedTransactionCount
// ---------------------------------------------------------------------------

describe("getUntaggedTransactionCount", () => {
  it("returns 0 on an empty database", () => {
    expect(getUntaggedTransactionCount(db)).toBe(0);
  });

  it("counts only untagged non-deleted expense transactions", () => {
    const tag = insertTag("food");
    const txTagged = insertTransaction({ amount: 10 });
    linkTag(txTagged, tag);

    // Untagged expense
    insertTransaction({ amount: 20 });
    // Untagged but deleted
    insertTransaction({ amount: 30, isDeleted: true });
    // Untagged but income
    insertTransaction({ amount: 40, isIncome: true });

    expect(getUntaggedTransactionCount(db)).toBe(1);
  });

  it("returns correct count with mix of tagged and untagged", () => {
    const tag = insertTag("misc");

    const tx1 = insertTransaction({ amount: 10 });
    linkTag(tx1, tag);

    insertTransaction({ amount: 20 });
    insertTransaction({ amount: 30 });

    expect(getUntaggedTransactionCount(db)).toBe(2);
  });

  it("returns 0 when all transactions are tagged", () => {
    const tag = insertTag("all");
    const tx1 = insertTransaction({ amount: 10 });
    const tx2 = insertTransaction({ amount: 20 });
    linkTag(tx1, tag);
    linkTag(tx2, tag);

    expect(getUntaggedTransactionCount(db)).toBe(0);
  });
});
