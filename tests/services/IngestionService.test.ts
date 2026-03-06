/**
 * IngestionService.test.ts
 *
 * Unit / integration tests for the smart ingestion behaviours implemented in
 * IngestionService.  Each test gets its own isolated in-memory database.
 *
 * Behaviours under test:
 * 1. Deduplication        – duplicate notifications are silently skipped.
 * 2. Auto-soft-delete     – new tx is immediately soft-deleted when a matching
 *                           soft-deleted tx exists.
 * 3. Auto-tag by vendor   – tags (except "AddedManually") are copied from the
 *                           most recent same-title transaction.
 * 4. AddedManually auto-tag – addManualTransaction always adds that tag
 *                            (tested via the hook; confirmed here to not
 *                            bleed into auto-tag propagation).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { ingestNotification } from "../../src/services/IngestionService";
import {
  addTransaction,
  softDeleteTransaction,
  getTransactionById,
} from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
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

/** Creates a fresh isolated in-memory database for each test. */
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
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp offset by `offsetSeconds` from a base time. */
function makeTimestamp(offsetSeconds = 0): string {
  return new Date(
    new Date("2024-01-01T10:00:00.000Z").getTime() + offsetSeconds * 1000
  ).toISOString();
}

/**
 * Builds the minimal transaction data shape required by `ingestNotification`.
 */
function makeTxData(
  title: string | null,
  body: string | null,
  packageName: string | null,
  receivedAt: string
) {
  return {
    notificationTitle: title,
    notificationBody: body,
    packageName,
    receivedAt,
    rawContent: [title, body].filter(Boolean).join(" ") || null,
    jsonContent: JSON.stringify({ title, body, packageName, timestamp: receivedAt }),
    amount: null,
    currency: null,
    isDeleted: false,
    isCash: false,
    isIncome: false,
  };
}

// ---------------------------------------------------------------------------
// 1. Deduplication
// ---------------------------------------------------------------------------

describe("ingestNotification – deduplication", () => {
  it("returns a Transaction when no duplicate exists", () => {
    const ts = makeTimestamp();

    const result = ingestNotification(db, makeTxData("Title A", "Body A", "com.app", ts));

    expect(result).not.toBeNull();
    expect(result!.notificationTitle).toBe("Title A");
  });

  it("returns null and does not persist when an identical notification is within ±5 s", () => {
    const ts = makeTimestamp();

    // First ingestion – should succeed.
    const first = ingestNotification(db, makeTxData("Title B", "Body B", "com.app", ts));
    expect(first).not.toBeNull();

    // Second ingestion with the same fields within 5 s – should be skipped.
    const tsPlus3 = makeTimestamp(3);
    const second = ingestNotification(
      db,
      makeTxData("Title B", "Body B", "com.app", tsPlus3)
    );
    expect(second).toBeNull();
  });

  it("persists when the same title+body arrives more than 5 s later", () => {
    const ts = makeTimestamp();

    ingestNotification(db, makeTxData("Title C", "Body C", "com.app", ts));

    // 6 s later – outside the dedup window.
    const tsSix = makeTimestamp(6);
    const result = ingestNotification(
      db,
      makeTxData("Title C", "Body C", "com.app", tsSix)
    );
    expect(result).not.toBeNull();
  });

  it("treats different packageName as a non-duplicate", () => {
    const ts = makeTimestamp();

    ingestNotification(db, makeTxData("Title D", "Body D", "com.app.one", ts));

    const result = ingestNotification(
      db,
      makeTxData("Title D", "Body D", "com.app.two", ts)
    );
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Auto-soft-delete
// ---------------------------------------------------------------------------

describe("ingestNotification – auto-soft-delete", () => {
  it("soft-deletes the new transaction when a matching soft-deleted tx exists", () => {

    // Create an existing transaction and soft-delete it.
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Vendor Pay",
        notificationBody: "10 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-60),
      })
    );
    softDeleteTransaction(db, existing.id);

    // Ingest a new notification with the same title+body.
    const ts = makeTimestamp();
    const result = ingestNotification(
      db,
      makeTxData("Vendor Pay", "10 EUR", "com.bank", ts)
    );

    expect(result).not.toBeNull();
    expect(result!.isDeleted).toBe(true);
  });

  it("does NOT soft-delete the new transaction when no matching soft-deleted tx exists", () => {
    const ts = makeTimestamp();

    const result = ingestNotification(
      db,
      makeTxData("Regular Pay", "5 EUR", "com.bank", ts)
    );

    expect(result).not.toBeNull();
    expect(result!.isDeleted).toBe(false);
  });

  it("only matches on title+body (different body means no auto-soft-delete)", () => {

    // Create an existing transaction and soft-delete it (different body).
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Pay",
        notificationBody: "old body",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-60),
      })
    );
    softDeleteTransaction(db, existing.id);

    const result = ingestNotification(
      db,
      makeTxData("Pay", "new body", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    expect(result!.isDeleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Auto-tag by vendor
// ---------------------------------------------------------------------------

describe("ingestNotification – auto-tag by vendor", () => {
  it("copies tags from the previous same-title transaction", () => {

    // Insert a previous transaction with a tag.
    const prev = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Coffee Shop",
        notificationBody: "3 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-120),
      })
    );
    const tag = addTag(db, "Food");
    addTagToTransaction(db, prev.id, tag.id);

    // Ingest a new notification with the same title.
    const result = ingestNotification(
      db,
      makeTxData("Coffee Shop", "3 EUR", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    const tagNames = result!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("Food");
  });

  it("does NOT copy the 'AddedManually' tag from the previous transaction", () => {

    // Insert a previous transaction tagged with 'AddedManually' and another tag.
    const prev = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Market",
        notificationBody: "7 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-120),
      })
    );
    const manualTag = addTag(db, "AddedManually");
    const vendorTag = addTag(db, "Groceries");
    addTagToTransaction(db, prev.id, manualTag.id);
    addTagToTransaction(db, prev.id, vendorTag.id);

    const result = ingestNotification(
      db,
      makeTxData("Market", "7 EUR", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    const tagNames = result!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("Groceries");
    expect(tagNames).not.toContain("AddedManually");
  });

  it("does not copy tags when no previous transaction with that title exists", () => {

    const result = ingestNotification(
      db,
      makeTxData("Brand New Vendor", "50 EUR", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    expect(result!.transactionTags).toHaveLength(0);
  });

  it("copies multiple tags from the previous transaction (excluding AddedManually)", () => {

    const prev = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Superstore",
        notificationBody: "20 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-120),
      })
    );
    const t1 = addTag(db, "AddedManually");
    const t2 = addTag(db, "Shopping");
    const t3 = addTag(db, "Monthly");
    addTagToTransaction(db, prev.id, t1.id);
    addTagToTransaction(db, prev.id, t2.id);
    addTagToTransaction(db, prev.id, t3.id);

    const result = ingestNotification(
      db,
      makeTxData("Superstore", "20 EUR", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    const tagNames = result!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("Shopping");
    expect(tagNames).toContain("Monthly");
    expect(tagNames).not.toContain("AddedManually");
  });

  it("uses the most recent previous transaction (not an older one) for auto-tagging", () => {

    // Older transaction tagged "OldTag".
    const older = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Pharmacy",
        notificationBody: "5 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-300),
      })
    );
    addTagToTransaction(db, older.id, addTag(db, "OldTag").id);

    // Newer transaction tagged "NewTag" (but not "OldTag").
    const newer = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Pharmacy",
        notificationBody: "5 EUR",
        packageName: "com.bank",
        receivedAt: makeTimestamp(-60),
      })
    );
    addTagToTransaction(db, newer.id, addTag(db, "NewTag").id);

    const result = ingestNotification(
      db,
      makeTxData("Pharmacy", "5 EUR", "com.bank", makeTimestamp())
    );

    expect(result).not.toBeNull();
    const tagNames = result!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("NewTag");
    expect(tagNames).not.toContain("OldTag");
  });
});

// ---------------------------------------------------------------------------
// 4. Interaction: auto-soft-delete + auto-tag
// ---------------------------------------------------------------------------

describe("ingestNotification – combined behaviours", () => {
  it("applies both auto-soft-delete and auto-tag in one ingestion", () => {

    // Previous transaction tagged "Recurring".
    const prev = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Netflix",
        notificationBody: "12 EUR",
        packageName: "com.netflix",
        receivedAt: makeTimestamp(-3600),
      })
    );
    addTagToTransaction(db, prev.id, addTag(db, "Recurring").id);

    // Also soft-delete a matching transaction to trigger auto-soft-delete.
    const toDelete = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Netflix",
        notificationBody: "12 EUR",
        packageName: "com.netflix",
        receivedAt: makeTimestamp(-1800),
      })
    );
    softDeleteTransaction(db, toDelete.id);

    const result = ingestNotification(
      db,
      makeTxData("Netflix", "12 EUR", "com.netflix", makeTimestamp())
    );

    expect(result).not.toBeNull();
    // Auto-soft-deleted because a soft-deleted match exists.
    expect(result!.isDeleted).toBe(true);
    // Auto-tagged from the previous non-deleted transaction.
    const tagNames = result!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("Recurring");
  });
});
