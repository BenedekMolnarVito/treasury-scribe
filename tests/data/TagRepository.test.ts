/**
 * TagRepository.test.ts
 *
 * Integration tests for TagRepository using a real in-memory sql.js database.
 * Each test gets a fresh database via beforeEach / afterEach so there is no
 * shared state between test cases.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import { initDatabase } from "../../src/data/DatabaseService";
import {
  addTag,
  searchTags,
  getMostCommonTags,
  getTagsOrderedByLastUsed,
  addTagToTransaction,
  removeTagFromTransaction,
} from "../../src/data/TagRepository";

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

/** Inserts a bare transaction row and returns its new id. */
function insertTransaction(receivedAt = "2024-01-01T00:00:00.000Z"): number {
  db.run(
    `INSERT INTO Transactions (ReceivedAt, IsDeleted, IsCash, IsIncome)
     VALUES (?, 0, 0, 0)`,
    [receivedAt]
  );
  const rows = db.exec("SELECT last_insert_rowid() AS id");
  return rows[0].values[0][0] as number;
}

// ---------------------------------------------------------------------------
// addTag
// ---------------------------------------------------------------------------

describe("addTag", () => {
  it("creates and returns a new tag", () => {
    const tag = addTag(db, "groceries");

    expect(tag.id).toBeGreaterThan(0);
    expect(tag.name).toBe("groceries");
    expect(tag.lastUsedAt).toBeTruthy();
    expect(tag.transactionTags).toEqual([]);
  });

  it("returns existing tag without error when called with a duplicate name", () => {
    const first = addTag(db, "groceries");
    const second = addTag(db, "groceries");

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("groceries");
  });

  it("creates distinct tags for different names", () => {
    const a = addTag(db, "food");
    const b = addTag(db, "transport");

    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// searchTags
// ---------------------------------------------------------------------------

describe("searchTags", () => {
  it("returns empty array for a query shorter than 2 characters", () => {
    addTag(db, "groceries");
    expect(searchTags(db, "")).toEqual([]);
    expect(searchTags(db, "g")).toEqual([]);
  });

  it("returns matching tags for a 2-character query", () => {
    addTag(db, "groceries");
    const results = searchTags(db, "gr");

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("groceries");
  });

  it("performs a substring (LIKE) match", () => {
    addTag(db, "food");
    addTag(db, "fast-food");
    addTag(db, "transport");

    const results = searchTags(db, "oo");
    const names = results.map((t) => t.name);

    expect(names).toContain("food");
    expect(names).toContain("fast-food");
    expect(names).not.toContain("transport");
  });

  it("returns at most 10 results", () => {
    for (let i = 0; i < 15; i++) {
      addTag(db, `tag-${i}`);
    }

    const results = searchTags(db, "tag");
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("orders results by usage count descending", () => {
    // All names share the substring "tag-" so a single query can match all three.
    const tagA = addTag(db, "tag-alpha");
    const tagB = addTag(db, "tag-beta");
    const tagC = addTag(db, "tag-gamma");

    // tagC → 2 transactions, tagA → 1 transaction, tagB → 0
    const tx1 = insertTransaction("2024-01-01T00:00:00.000Z");
    const tx2 = insertTransaction("2024-01-02T00:00:00.000Z");
    const tx3 = insertTransaction("2024-01-03T00:00:00.000Z");

    addTagToTransaction(db, tx1, tagC.id);
    addTagToTransaction(db, tx2, tagC.id);
    addTagToTransaction(db, tx3, tagA.id);

    const results = searchTags(db, "tag-"); // matches all three (4 chars ≥ 2)
    const names = results.map((t) => t.name);

    expect(names.indexOf("tag-gamma")).toBeLessThan(names.indexOf("tag-alpha"));
    expect(names.indexOf("tag-alpha")).toBeLessThan(names.indexOf("tag-beta"));
  });

  it("returns empty array when no tag matches the query", () => {
    addTag(db, "groceries");
    expect(searchTags(db, "xyz")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMostCommonTags
// ---------------------------------------------------------------------------

describe("getMostCommonTags", () => {
  it("returns N tags ordered by transaction count descending", () => {
    const tagA = addTag(db, "often");
    const tagB = addTag(db, "sometimes");
    const tagC = addTag(db, "rarely");

    const tx1 = insertTransaction("2024-01-01T00:00:00.000Z");
    const tx2 = insertTransaction("2024-01-02T00:00:00.000Z");
    const tx3 = insertTransaction("2024-01-03T00:00:00.000Z");

    addTagToTransaction(db, tx1, tagA.id);
    addTagToTransaction(db, tx2, tagA.id);
    addTagToTransaction(db, tx3, tagA.id);
    addTagToTransaction(db, tx1, tagB.id);
    addTagToTransaction(db, tx2, tagB.id);
    // tagC has no transactions

    const top = getMostCommonTags(db, 2);
    expect(top).toHaveLength(2);
    expect(top[0].name).toBe("often");
    expect(top[1].name).toBe("sometimes");
  });

  it("respects the limit parameter", () => {
    addTag(db, "a");
    addTag(db, "b");
    addTag(db, "c");

    const top = getMostCommonTags(db, 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array when there are no tags", () => {
    expect(getMostCommonTags(db, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTagsOrderedByLastUsed
// ---------------------------------------------------------------------------

describe("getTagsOrderedByLastUsed", () => {
  it("returns all tags sorted by lastUsedAt DESC", () => {
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "older",
      "2024-01-01T00:00:00.000Z",
    ]);
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "newer",
      "2024-06-01T00:00:00.000Z",
    ]);
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "newest",
      "2024-12-31T00:00:00.000Z",
    ]);

    const tags = getTagsOrderedByLastUsed(db);
    expect(tags[0].name).toBe("newest");
    expect(tags[1].name).toBe("newer");
    expect(tags[2].name).toBe("older");
  });

  it("returns empty array when there are no tags", () => {
    expect(getTagsOrderedByLastUsed(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addTagToTransaction
// ---------------------------------------------------------------------------

describe("addTagToTransaction", () => {
  it("creates a TransactionTags row", () => {
    const tag = addTag(db, "food");
    const txId = insertTransaction();

    addTagToTransaction(db, txId, tag.id);

    const rows = db.exec(
      "SELECT * FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tag.id]
    );
    expect(rows[0].values).toHaveLength(1);
  });

  it("updates Tag.lastUsedAt", () => {
    const tag = addTag(db, "food");
    const before = tag.lastUsedAt;
    const txId = insertTransaction();

    // Ensure some time passes for the timestamp to differ.
    const later = new Date(new Date(before).getTime() + 1000).toISOString();
    db.run("UPDATE Tags SET LastUsedAt = ? WHERE Id = ?", [before, tag.id]);

    addTagToTransaction(db, txId, tag.id);

    const rows = db.exec("SELECT LastUsedAt FROM Tags WHERE Id = ?", [tag.id]);
    const newLastUsedAt = rows[0].values[0][0] as string;
    expect(newLastUsedAt).not.toBe(before);
    // The new timestamp should be close to "now" (after `before`)
    expect(newLastUsedAt >= later || newLastUsedAt > before).toBe(true);
  });

  it("does not throw on duplicate link (idempotent via unique index)", () => {
    const tag = addTag(db, "food");
    const txId = insertTransaction();

    addTagToTransaction(db, txId, tag.id);
    // Second call must not throw
    expect(() => addTagToTransaction(db, txId, tag.id)).not.toThrow();

    // Still only one row in the junction table
    const rows = db.exec(
      "SELECT COUNT(*) AS cnt FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tag.id]
    );
    expect(rows[0].values[0][0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// removeTagFromTransaction
// ---------------------------------------------------------------------------

describe("removeTagFromTransaction", () => {
  it("removes the TransactionTags row", () => {
    const tag = addTag(db, "food");
    const txId = insertTransaction();
    addTagToTransaction(db, txId, tag.id);

    removeTagFromTransaction(db, txId, tag.id);

    const rows = db.exec(
      "SELECT COUNT(*) AS cnt FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tag.id]
    );
    expect(rows[0].values[0][0]).toBe(0);
  });

  it("does not throw when the link does not exist", () => {
    const tag = addTag(db, "food");
    const txId = insertTransaction();

    expect(() => removeTagFromTransaction(db, txId, tag.id)).not.toThrow();
  });

  it("only removes the specified link, not others", () => {
    const tagA = addTag(db, "food");
    const tagB = addTag(db, "transport");
    const txId = insertTransaction();

    addTagToTransaction(db, txId, tagA.id);
    addTagToTransaction(db, txId, tagB.id);

    removeTagFromTransaction(db, txId, tagA.id);

    const rows = db.exec(
      "SELECT COUNT(*) AS cnt FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagB.id]
    );
    expect(rows[0].values[0][0]).toBe(1);
  });
});
