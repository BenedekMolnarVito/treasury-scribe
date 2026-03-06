/**
 * useEditTransaction.test.ts
 *
 * Unit / integration tests for the useEditTransaction hook.
 *
 * Environment: jsdom (required for React hooks via renderHook).
 * sql.js WASM binary is loaded once before all tests; each test receives its
 * own in-memory database for full isolation.
 */

// @vitest-environment jsdom

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { addTransaction } from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import { useEditTransaction } from "../../src/hooks/useEditTransaction";

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

/** Creates a fresh in-memory database for each test. */
async function makeDb(): Promise<Database> {
  return initDatabase(wasmBinary);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inserts a transaction with known fields and returns its id.
 */
function insertTransaction(
  db: Database,
  overrides: Partial<{
    title: string;
    body: string;
    isCash: boolean;
    isIncome: boolean;
  }> = {}
): number {
  const tx = addTransaction(db, {
    ...createTransaction({ receivedAt: new Date().toISOString() }),
    notificationTitle: overrides.title ?? "Test Title",
    notificationBody: overrides.body ?? "Test Body",
    isCash: overrides.isCash ?? false,
    isIncome: overrides.isIncome ?? false,
  });
  return tx.id;
}

// ---------------------------------------------------------------------------
// loadTransaction
// ---------------------------------------------------------------------------

describe("loadTransaction", () => {
  it("populates title from notificationTitle", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { title: "My Title" });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));

    expect(result.current.title).toBe("My Title");
  });

  it("populates description from notificationBody", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { body: "My Body" });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));

    expect(result.current.description).toBe("My Body");
  });

  it("populates isCash", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { isCash: true });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));

    expect(result.current.isCash).toBe(true);
  });

  it("populates isIncome", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { isIncome: true });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));

    expect(result.current.isIncome).toBe(true);
  });

  it("populates currentTags from linked tags", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const tag = addTag(db, "groceries");
    addTagToTransaction(db, id, tag.id);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));

    expect(result.current.currentTags).toHaveLength(1);
    expect(result.current.currentTags[0].name).toBe("groceries");
  });

  it("resets newTagName to empty string", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => {
      result.current.setNewTagName("something");
    });
    act(() => result.current.loadTransaction(id));

    expect(result.current.newTagName).toBe("");
  });

  it("throws when the transaction id does not exist", async () => {
    const db = await makeDb();

    const { result } = renderHook(() => useEditTransaction(db));

    expect(() => act(() => result.current.loadTransaction(9999))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe("save", () => {
  it("persists edited title back to the database", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { title: "Original" });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.setTitle("Updated Title"));
    act(() => result.current.save());

    // Re-load the hook with a fresh render to confirm persistence.
    const { result: result2 } = renderHook(() => useEditTransaction(db));
    act(() => result2.current.loadTransaction(id));

    expect(result2.current.title).toBe("Updated Title");
  });

  it("persists edited description back to the database", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { body: "Original body" });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.setDescription("Updated Body"));
    act(() => result.current.save());

    const { result: result2 } = renderHook(() => useEditTransaction(db));
    act(() => result2.current.loadTransaction(id));

    expect(result2.current.description).toBe("Updated Body");
  });

  it("persists isCash change", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { isCash: false });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.setIsCash(true));
    act(() => result.current.save());

    const { result: result2 } = renderHook(() => useEditTransaction(db));
    act(() => result2.current.loadTransaction(id));

    expect(result2.current.isCash).toBe(true);
  });

  it("persists isIncome change", async () => {
    const db = await makeDb();
    const id = insertTransaction(db, { isIncome: false });

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.setIsIncome(true));
    act(() => result.current.save());

    const { result: result2 } = renderHook(() => useEditTransaction(db));
    act(() => result2.current.loadTransaction(id));

    expect(result2.current.isIncome).toBe(true);
  });

  it("is a no-op when no transaction has been loaded", async () => {
    const db = await makeDb();

    const { result } = renderHook(() => useEditTransaction(db));

    // Should not throw.
    expect(() => act(() => result.current.save())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// addTag
// ---------------------------------------------------------------------------

describe("addTag", () => {
  it("creates a new tag and links it to the transaction", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.addTag("transport"));

    expect(result.current.currentTags.some((t) => t.name === "transport")).toBe(true);
  });

  it("finds an existing tag by name instead of creating a duplicate", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    // Pre-create the tag.
    const existing = addTag(db, "food");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.addTag("food"));

    // Only one tag named 'food' should exist.
    const foodTags = result.current.currentTags.filter((t) => t.name === "food");
    expect(foodTags).toHaveLength(1);
    expect(foodTags[0].id).toBe(existing.id);
  });

  it("does not duplicate a tag already linked to the transaction", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.addTag("utilities"));
    act(() => result.current.addTag("utilities"));

    const utilTags = result.current.currentTags.filter((t) => t.name === "utilities");
    expect(utilTags).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeTag
// ---------------------------------------------------------------------------

describe("removeTag", () => {
  it("unlinks the tag from the transaction", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const tag = addTag(db, "removable");
    addTagToTransaction(db, id, tag.id);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    expect(result.current.currentTags.some((t) => t.id === tag.id)).toBe(true);

    act(() => result.current.removeTag(tag.id));

    expect(result.current.currentTags.some((t) => t.id === tag.id)).toBe(false);
  });

  it("persists the removal (tag stays unlinked after reload)", async () => {
    const db = await makeDb();
    const id = insertTransaction(db);

    const tag = addTag(db, "temporary");
    addTagToTransaction(db, id, tag.id);

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadTransaction(id));
    act(() => result.current.removeTag(tag.id));

    // Reload via a fresh hook instance.
    const { result: result2 } = renderHook(() => useEditTransaction(db));
    act(() => result2.current.loadTransaction(id));

    expect(result2.current.currentTags.some((t) => t.id === tag.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchTags (debounced)
// ---------------------------------------------------------------------------

describe("searchTags", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not update searchResults for queries under 2 characters", async () => {
    const db = await makeDb();
    addTag(db, "alpha");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.searchTags("a"));
    act(() => vi.runAllTimers());

    expect(result.current.searchResults).toHaveLength(0);
  });

  it("clears searchResults immediately for short queries", async () => {
    const db = await makeDb();
    addTag(db, "alpha");

    const { result } = renderHook(() => useEditTransaction(db));

    // First do a valid search and let it fire.
    act(() => result.current.searchTags("al"));
    act(() => vi.runAllTimers());
    expect(result.current.searchResults.length).toBeGreaterThan(0);

    // Now send a short query — results should clear immediately.
    act(() => result.current.searchTags("a"));
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("does not fire before the 300 ms debounce window", async () => {
    const db = await makeDb();
    addTag(db, "beta");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.searchTags("be"));
    // Timer not yet expired.
    expect(result.current.searchResults).toHaveLength(0);
  });

  it("fires after the 300 ms debounce window and returns matching tags", async () => {
    const db = await makeDb();
    addTag(db, "gamma");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.searchTags("ga"));
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.searchResults.some((t) => t.name === "gamma")).toBe(true);
  });

  it("debounces multiple rapid calls (only fires once)", async () => {
    const db = await makeDb();
    addTag(db, "delta");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => {
      result.current.searchTags("de");
      result.current.searchTags("del");
      result.current.searchTags("delt");
      result.current.searchTags("delta");
    });

    act(() => vi.advanceTimersByTime(300));

    // Only the final query 'delta' fires; all tags matching 'delta' are returned.
    expect(result.current.searchResults.some((t) => t.name === "delta")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadRecentTags
// ---------------------------------------------------------------------------

describe("loadRecentTags", () => {
  it("returns the top-5 most common tags", async () => {
    const db = await makeDb();

    // Create 7 tags with varying usage counts.
    const tagNames = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    const tags = tagNames.map((name) => addTag(db, name));

    // Link tags to multiple transactions so counts differ.
    for (let i = 0; i < tags.length; i++) {
      // Insert (7 - i) transactions and link to tag[i].
      for (let j = 0; j < 7 - i; j++) {
        const txId = insertTransaction(db);
        addTagToTransaction(db, txId, tags[i].id);
      }
    }

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadRecentTags());

    expect(result.current.recentTags).toHaveLength(5);
    // The tag with the most links (t1, 7 usages) should appear first.
    expect(result.current.recentTags[0].name).toBe("t1");
  });

  it("returns fewer than 5 when fewer tags exist", async () => {
    const db = await makeDb();
    addTag(db, "only");

    const { result } = renderHook(() => useEditTransaction(db));

    act(() => result.current.loadRecentTags());

    expect(result.current.recentTags).toHaveLength(1);
  });
});
