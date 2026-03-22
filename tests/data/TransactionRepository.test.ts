/**
 * TransactionRepository.test.ts
 *
 * Full integration tests for TransactionRepository using a real in-memory
 * sql.js database.  Every test gets a fresh database via beforeEach / afterEach
 * so there is no shared state between test cases.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import { initDatabase } from "../../src/data/DatabaseService";
import {
  addTag,
  addTagToTransaction,
} from "../../src/data/TagRepository";
import {
  getAllTransactions,
  getAllTransactionsIncludingDeleted,
  getTransactionById,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  softDeleteTransaction,
  softDeleteAllTransactions,
  existsDuplicate,
  findSoftDeletedMatch,
  findLastTransactionByTitle,
  getActiveTagsWithCounts,
  getTransactionsByTagFilter,
} from "../../src/data/TransactionRepository";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const WASM_PATH = resolve(
  __dirname,
  "../../node_modules/sql.js/dist/sql-wasm.wasm"
);

let wasmBinary: ArrayBuffer;
let db: Database;

// Load WASM binary once (expensive) and reuse across tests.
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
// Fixtures
// ---------------------------------------------------------------------------

function makeTransaction(
  overrides: Partial<{
    rawContent: string | null;
    jsonContent: string | null;
    receivedAt: string;
    notificationTitle: string | null;
    notificationBody: string | null;
    packageName: string | null;
    isDeleted: boolean;
    isCash: boolean;
    amount: number | null;
    currency: string | null;
    isIncome: boolean;
  }> = {}
) {
  return {
    rawContent: overrides.rawContent ?? "raw",
    jsonContent: overrides.jsonContent ?? null,
    receivedAt: overrides.receivedAt ?? "2024-01-01T10:00:00.000Z",
    notificationTitle: overrides.notificationTitle ?? "Revolut",
    notificationBody: overrides.notificationBody ?? "You paid €10.00",
    packageName: overrides.packageName ?? "com.revolut.revolut",
    isDeleted: overrides.isDeleted ?? false,
    isCash: overrides.isCash ?? false,
    amount: overrides.amount ?? 10.0,
    currency: overrides.currency ?? "EUR",
    isIncome: overrides.isIncome ?? false,
  };
}

// ---------------------------------------------------------------------------
// getAllTransactions
// ---------------------------------------------------------------------------

describe("getAllTransactions", () => {
  it("returns an empty array when no transactions exist", () => {
    expect(getAllTransactions(db)).toEqual([]);
  });

  it("returns only non-deleted transactions", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Active" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Deleted", isDeleted: true }));

    const results = getAllTransactions(db);
    expect(results).toHaveLength(1);
    expect(results[0].notificationTitle).toBe("Active");
  });

  it("orders results by receivedAt DESC", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Older", receivedAt: "2024-01-01T08:00:00.000Z" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Newer", receivedAt: "2024-01-01T12:00:00.000Z" }));

    const results = getAllTransactions(db);
    expect(results[0].notificationTitle).toBe("Newer");
    expect(results[1].notificationTitle).toBe("Older");
  });

  it("eager-loads tags via JOIN", () => {
    const tx = addTransaction(db, makeTransaction());
    // Add a tag and link it manually
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('food', '2024-01-01T00:00:00.000Z')");
    const tagRows = db.exec("SELECT last_insert_rowid() AS id");
    const tagId = tagRows[0].values[0][0] as number;
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId]);

    const results = getAllTransactions(db);
    expect(results[0].transactionTags).toHaveLength(1);
    expect(results[0].transactionTags[0].tagId).toBe(tagId);
  });

  it("does not duplicate the transaction row when it has multiple tags", () => {
    const tx = addTransaction(db, makeTransaction());
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('food', '2024-01-01T00:00:00.000Z')");
    const r1 = db.exec("SELECT last_insert_rowid() AS id");
    const tagId1 = r1[0].values[0][0] as number;
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('travel', '2024-01-01T00:00:00.000Z')");
    const r2 = db.exec("SELECT last_insert_rowid() AS id");
    const tagId2 = r2[0].values[0][0] as number;
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId1]);
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId2]);

    const results = getAllTransactions(db);
    expect(results).toHaveLength(1);
    expect(results[0].transactionTags).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getAllTransactionsIncludingDeleted
// ---------------------------------------------------------------------------

describe("getAllTransactionsIncludingDeleted", () => {
  it("includes soft-deleted transactions", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Active" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Deleted", isDeleted: true }));

    const results = getAllTransactionsIncludingDeleted(db);
    expect(results).toHaveLength(2);
  });

  it("still orders by receivedAt DESC", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "A", receivedAt: "2024-01-01T08:00:00.000Z", isDeleted: true }));
    addTransaction(db, makeTransaction({ notificationTitle: "B", receivedAt: "2024-01-01T12:00:00.000Z" }));

    const results = getAllTransactionsIncludingDeleted(db);
    expect(results[0].notificationTitle).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// getTransactionById
// ---------------------------------------------------------------------------

describe("getTransactionById", () => {
  it("returns null when the id does not exist", () => {
    expect(getTransactionById(db, 9999)).toBeNull();
  });

  it("returns the transaction with the given id", () => {
    const tx = addTransaction(db, makeTransaction({ notificationTitle: "FindMe" }));
    const found = getTransactionById(db, tx.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(tx.id);
    expect(found!.notificationTitle).toBe("FindMe");
  });

  it("eager-loads tags for the returned transaction", () => {
    const tx = addTransaction(db, makeTransaction());
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('x', '2024-01-01T00:00:00.000Z')");
    const tagRows = db.exec("SELECT last_insert_rowid() AS id");
    const tagId = tagRows[0].values[0][0] as number;
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId]);

    const found = getTransactionById(db, tx.id)!;
    expect(found.transactionTags).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// addTransaction
// ---------------------------------------------------------------------------

describe("addTransaction", () => {
  it("inserts a new row and returns the entity with an assigned id", () => {
    const tx = addTransaction(db, makeTransaction({ notificationTitle: "New" }));
    expect(typeof tx.id).toBe("number");
    expect(tx.notificationTitle).toBe("New");
  });

  it("persists all fields correctly", () => {
    const data = makeTransaction({
      rawContent: "raw text",
      jsonContent: '{"amount":42,"currency":"HUF"}',
      receivedAt: "2024-06-15T09:30:00.000Z",
      notificationTitle: "Test Title",
      notificationBody: "Test Body",
      packageName: "com.example.app",
      isDeleted: false,
      isCash: true,
      amount: 42,
      currency: "HUF",
      isIncome: true,
    });
    const tx = addTransaction(db, data);
    expect(tx.rawContent).toBe("raw text");
    expect(tx.isCash).toBe(true);
    expect(tx.amount).toBe(42);
    expect(tx.currency).toBe("HUF");
    expect(tx.isIncome).toBe(true);
  });

  it("returns empty transactionTags on a newly inserted transaction", () => {
    const tx = addTransaction(db, makeTransaction());
    expect(tx.transactionTags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateTransaction
// ---------------------------------------------------------------------------

describe("updateTransaction", () => {
  it("updates scalar fields", () => {
    const tx = addTransaction(db, makeTransaction({ notificationTitle: "Before" }));
    updateTransaction(db, { ...tx, notificationTitle: "After", amount: 99 });

    const updated = getTransactionById(db, tx.id)!;
    expect(updated.notificationTitle).toBe("After");
    expect(updated.amount).toBe(99);
  });

  it("does not affect other rows", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "T1" }));
    const tx2 = addTransaction(db, makeTransaction({ notificationTitle: "T2" }));
    updateTransaction(db, { ...tx1, notificationTitle: "T1-updated" });

    expect(getTransactionById(db, tx2.id)!.notificationTitle).toBe("T2");
  });
});

// ---------------------------------------------------------------------------
// deleteTransaction (hard delete)
// ---------------------------------------------------------------------------

describe("deleteTransaction", () => {
  it("removes the row from the database", () => {
    const tx = addTransaction(db, makeTransaction());
    deleteTransaction(db, tx.id);
    expect(getTransactionById(db, tx.id)).toBeNull();
  });

  it("cascades to TransactionTags", () => {
    const tx = addTransaction(db, makeTransaction());
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('cascade', '2024-01-01T00:00:00.000Z')");
    const r = db.exec("SELECT last_insert_rowid() AS id");
    const tagId = r[0].values[0][0] as number;
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId]);

    deleteTransaction(db, tx.id);
    const ttRows = db.exec(`SELECT * FROM TransactionTags WHERE TransactionId = ${tx.id}`);
    expect(ttRows.length === 0 || ttRows[0].values.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// softDeleteTransaction
// ---------------------------------------------------------------------------

describe("softDeleteTransaction", () => {
  it("sets IsDeleted = 1 for the target row", () => {
    const tx = addTransaction(db, makeTransaction());
    expect(tx.isDeleted).toBe(false);

    softDeleteTransaction(db, tx.id);
    const updated = getTransactionById(db, tx.id)!;
    expect(updated.isDeleted).toBe(true);
  });

  it("does not remove the row from the database", () => {
    const tx = addTransaction(db, makeTransaction());
    softDeleteTransaction(db, tx.id);
    expect(getTransactionById(db, tx.id)).not.toBeNull();
  });

  it("does not affect other rows", () => {
    const tx1 = addTransaction(db, makeTransaction());
    const tx2 = addTransaction(db, makeTransaction());
    softDeleteTransaction(db, tx1.id);
    expect(getTransactionById(db, tx2.id)!.isDeleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// softDeleteAllTransactions
// ---------------------------------------------------------------------------

describe("softDeleteAllTransactions", () => {
  it("sets IsDeleted = 1 on all rows", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "A" }));
    addTransaction(db, makeTransaction({ notificationTitle: "B" }));

    softDeleteAllTransactions(db);

    const all = getAllTransactionsIncludingDeleted(db);
    expect(all.every((t) => t.isDeleted)).toBe(true);
  });

  it("results in getAllTransactions returning an empty list", () => {
    addTransaction(db, makeTransaction());
    softDeleteAllTransactions(db);
    expect(getAllTransactions(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// existsDuplicate
// ---------------------------------------------------------------------------

describe("existsDuplicate", () => {
  const BASE_TIME = "2024-03-01T12:00:00.000Z";
  const TITLE = "Revolut";
  const BODY = "You paid €5";
  const PKG = "com.revolut.revolut";

  it("returns false when no transactions exist", () => {
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(false);
  });

  it("returns true for exact same timestamp", () => {
    addTransaction(db, makeTransaction({ notificationTitle: TITLE, notificationBody: BODY, packageName: PKG, receivedAt: BASE_TIME }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(true);
  });

  it("returns true when within 5-second window (4 seconds apart)", () => {
    addTransaction(db, makeTransaction({
      notificationTitle: TITLE,
      notificationBody: BODY,
      packageName: PKG,
      receivedAt: "2024-03-01T12:00:04.000Z",
    }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(true);
  });

  it("returns false when outside 5-second window (6 seconds apart)", () => {
    addTransaction(db, makeTransaction({
      notificationTitle: TITLE,
      notificationBody: BODY,
      packageName: PKG,
      receivedAt: "2024-03-01T12:00:06.000Z",
    }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(false);
  });

  it("returns false when title differs", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Other", notificationBody: BODY, packageName: PKG, receivedAt: BASE_TIME }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(false);
  });

  it("returns false when body differs", () => {
    addTransaction(db, makeTransaction({ notificationTitle: TITLE, notificationBody: "Other", packageName: PKG, receivedAt: BASE_TIME }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(false);
  });

  it("returns false when packageName differs", () => {
    addTransaction(db, makeTransaction({ notificationTitle: TITLE, notificationBody: BODY, packageName: "other.app", receivedAt: BASE_TIME }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(false);
  });

  it("returns true at exactly the 5-second boundary", () => {
    addTransaction(db, makeTransaction({
      notificationTitle: TITLE,
      notificationBody: BODY,
      packageName: PKG,
      receivedAt: "2024-03-01T12:00:05.000Z",
    }));
    expect(existsDuplicate(db, TITLE, BODY, PKG, BASE_TIME)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findSoftDeletedMatch
// ---------------------------------------------------------------------------

describe("findSoftDeletedMatch", () => {
  it("returns null when no match exists", () => {
    expect(findSoftDeletedMatch(db, "No Match", "No Body")).toBeNull();
  });

  it("returns null when a matching transaction is not soft-deleted", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Title", notificationBody: "Body", isDeleted: false }));
    expect(findSoftDeletedMatch(db, "Title", "Body")).toBeNull();
  });

  it("returns the soft-deleted transaction when title and body match", () => {
    const tx = addTransaction(db, makeTransaction({ notificationTitle: "T", notificationBody: "B", isDeleted: true }));
    const found = findSoftDeletedMatch(db, "T", "B");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(tx.id);
  });

  it("returns null when body matches but title differs", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Wrong", notificationBody: "Body", isDeleted: true }));
    expect(findSoftDeletedMatch(db, "Title", "Body")).toBeNull();
  });

  it("returns the most recent match when multiple exist", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "T", notificationBody: "B", isDeleted: true, receivedAt: "2024-01-01T08:00:00.000Z" }));
    const latest = addTransaction(db, makeTransaction({ notificationTitle: "T", notificationBody: "B", isDeleted: true, receivedAt: "2024-01-01T12:00:00.000Z" }));

    const found = findSoftDeletedMatch(db, "T", "B");
    expect(found!.id).toBe(latest.id);
  });
});

// ---------------------------------------------------------------------------
// findLastTransactionByTitle
// ---------------------------------------------------------------------------

describe("findLastTransactionByTitle", () => {
  it("returns null when no transaction has the given title", () => {
    expect(findLastTransactionByTitle(db, "Unknown")).toBeNull();
  });

  it("returns null when only soft-deleted transactions match", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Revolut", isDeleted: true }));
    expect(findLastTransactionByTitle(db, "Revolut")).toBeNull();
  });

  it("returns the most recent non-deleted transaction with the given title", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "Revolut", receivedAt: "2024-01-01T08:00:00.000Z" }));
    const latest = addTransaction(db, makeTransaction({ notificationTitle: "Revolut", receivedAt: "2024-01-01T12:00:00.000Z" }));

    const found = findLastTransactionByTitle(db, "Revolut");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(latest.id);
  });

  it("eager-loads tags for the returned transaction", () => {
    const tx = addTransaction(db, makeTransaction({ notificationTitle: "Revolut" }));
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES ('vendor', '2024-01-01T00:00:00.000Z')");
    const r = db.exec("SELECT last_insert_rowid() AS id");
    const tagId = r[0].values[0][0] as number;
    db.run("INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, '2024-01-01T00:00:00.000Z')", [tx.id, tagId]);

    const found = findLastTransactionByTitle(db, "Revolut")!;
    expect(found.transactionTags).toHaveLength(1);
    expect(found.transactionTags[0].tagId).toBe(tagId);
  });

  it("ignores deleted transactions even if they are more recent", () => {
    const active = addTransaction(db, makeTransaction({ notificationTitle: "Revolut", receivedAt: "2024-01-01T08:00:00.000Z", isDeleted: false }));
    addTransaction(db, makeTransaction({ notificationTitle: "Revolut", receivedAt: "2024-01-01T12:00:00.000Z", isDeleted: true }));

    const found = findLastTransactionByTitle(db, "Revolut");
    expect(found!.id).toBe(active.id);
  });
});

// ---------------------------------------------------------------------------
// getActiveTagsWithCounts
// ---------------------------------------------------------------------------

describe("getActiveTagsWithCounts", () => {
  it("returns empty array when no tags exist", () => {
    expect(getActiveTagsWithCounts(db)).toEqual([]);
  });

  it("returns empty when tags exist but no non-deleted transactions have them", () => {
    const tx = addTransaction(db, makeTransaction({ isDeleted: true }));
    const tag = addTag(db, "Orphan");
    addTagToTransaction(db, tx.id, tag.id);
    expect(getActiveTagsWithCounts(db)).toEqual([]);
  });

  it("returns tags with correct counts", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "A" }));
    const tx2 = addTransaction(db, makeTransaction({ notificationTitle: "B" }));
    const tx3 = addTransaction(db, makeTransaction({ notificationTitle: "C" }));
    const food = addTag(db, "Food");
    const transport = addTag(db, "Transport");
    addTagToTransaction(db, tx1.id, food.id);
    addTagToTransaction(db, tx2.id, food.id);
    addTagToTransaction(db, tx3.id, transport.id);

    const result = getActiveTagsWithCounts(db);
    expect(result).toHaveLength(2);
    expect(result[0]!.tagName).toBe("Food");
    expect(result[0]!.count).toBe(2);
    expect(result[1]!.tagName).toBe("Transport");
    expect(result[1]!.count).toBe(1);
  });

  it("excludes tags only on soft-deleted transactions", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Active" }));
    const tx2 = addTransaction(db, makeTransaction({ notificationTitle: "Deleted", isDeleted: true }));
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, tag.id);
    addTagToTransaction(db, tx2.id, tag.id);

    const result = getActiveTagsWithCounts(db);
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTransactionsByTagFilter
// ---------------------------------------------------------------------------

describe("getTransactionsByTagFilter", () => {
  it("returns all non-deleted transactions when no filter is set (empty tagIds + includeUntagged)", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "A" }));
    addTransaction(db, makeTransaction({ notificationTitle: "B" }));
    // Both are untagged, so both match the untagged filter
    const result = getTransactionsByTagFilter(db, [], true);
    expect(result).toHaveLength(2);
  });

  it("returns empty when no tags selected and includeUntagged is false", () => {
    addTransaction(db, makeTransaction({ notificationTitle: "A" }));
    const result = getTransactionsByTagFilter(db, [], false);
    expect(result).toHaveLength(0);
  });

  it("filters by specific tag", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Food TX" }));
    addTransaction(db, makeTransaction({ notificationTitle: "No Tag TX" }));
    const food = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, food.id);

    const result = getTransactionsByTagFilter(db, [food.id], false);
    expect(result).toHaveLength(1);
    expect(result[0]!.notificationTitle).toBe("Food TX");
  });

  it("returns only untagged when includeUntagged is true and no tags selected", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Tagged" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Untagged" }));
    const food = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, food.id);

    const result = getTransactionsByTagFilter(db, [], true);
    expect(result).toHaveLength(1);
    expect(result[0]!.notificationTitle).toBe("Untagged");
  });

  it("combines tag filter with includeUntagged", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Food TX" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Untagged TX" }));
    const tx3 = addTransaction(db, makeTransaction({ notificationTitle: "Transport TX" }));
    const food = addTag(db, "Food");
    const transport = addTag(db, "Transport");
    addTagToTransaction(db, tx1.id, food.id);
    addTagToTransaction(db, tx3.id, transport.id);

    // Filter to Food + untagged
    const result = getTransactionsByTagFilter(db, [food.id], true);
    expect(result).toHaveLength(2);
    const titles = result.map((t) => t.notificationTitle);
    expect(titles).toContain("Food TX");
    expect(titles).toContain("Untagged TX");
    expect(titles).not.toContain("Transport TX");
  });

  it("excludes soft-deleted transactions", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Active", isDeleted: false }));
    addTransaction(db, makeTransaction({ notificationTitle: "Deleted", isDeleted: true }));
    const food = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, food.id);

    const result = getTransactionsByTagFilter(db, [food.id], true);
    expect(result.every((t) => !t.isDeleted)).toBe(true);
  });

  it("supports multi-tag filter", () => {
    const tx1 = addTransaction(db, makeTransaction({ notificationTitle: "Food TX" }));
    const tx2 = addTransaction(db, makeTransaction({ notificationTitle: "Transport TX" }));
    addTransaction(db, makeTransaction({ notificationTitle: "Other TX" }));
    const food = addTag(db, "Food");
    const transport = addTag(db, "Transport");
    addTagToTransaction(db, tx1.id, food.id);
    addTagToTransaction(db, tx2.id, transport.id);

    const result = getTransactionsByTagFilter(db, [food.id, transport.id], false);
    expect(result).toHaveLength(2);
    const titles = result.map((t) => t.notificationTitle);
    expect(titles).toContain("Food TX");
    expect(titles).toContain("Transport TX");
  });
});
