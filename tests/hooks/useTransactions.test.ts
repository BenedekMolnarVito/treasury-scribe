/**
 * useTransactions.test.ts
 *
 * Unit / integration tests for the useTransactions hook.
 *
 * Environment: jsdom (required for React hooks via renderHook).
 * The sql.js WASM binary is loaded once before all tests; each test receives
 * its own in-memory database so tests remain fully isolated.
 */

// @vitest-environment jsdom

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { useTransactions } from "../../src/hooks/useTransactions";

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
// Share mock
// ---------------------------------------------------------------------------

/** Records arguments passed to the injected share function. */
function makeShareMock() {
  const calls: Array<{ title: string; text: string }> = [];
  const fn = vi.fn(async (title: string, text: string) => {
    calls.push({ title, text });
  });
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render the hook with an optional share mock and return helpers.
 */
async function setup(db: Database, shareMock?: ReturnType<typeof makeShareMock>) {
  const { result } = renderHook(() =>
    useTransactions(db, shareMock?.fn)
  );
  return result;
}

// ---------------------------------------------------------------------------
// loadTransactions
// ---------------------------------------------------------------------------

describe("loadTransactions", () => {
  it("starts with an empty list and loading=false", async () => {
    const db = await makeDb();
    const result = await setup(db);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("populates transactions state and sets loading=false when complete", async () => {
    const db = await makeDb();
    // Insert one transaction directly via the hook's addManualTransaction.
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Test title", "Test body");
    });

    // After addManualTransaction the list is refreshed; load again explicitly.
    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.transactions.length).toBeGreaterThan(0);
    expect(result.current.transactions[0]?.notificationTitle).toBe("Test title");
  });

  it("returns an empty list when the database is empty", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// showDeleted toggle
// ---------------------------------------------------------------------------

describe("showDeleted toggle", () => {
  it("excludes soft-deleted rows when showDeleted=false", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // Add and then soft-delete a transaction.
    await act(async () => {
      await result.current.addManualTransaction("Deleted tx", "body");
    });

    const id = result.current.transactions[0]?.id;
    expect(id).toBeDefined();

    await act(async () => {
      await result.current.softDeleteTransaction(id!);
    });

    expect(result.current.transactions).toEqual([]);
  });

  it("includes soft-deleted rows when showDeleted=true", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Deleted tx", "body");
    });

    const id = result.current.transactions[0]?.id;
    expect(id).toBeDefined();

    await act(async () => {
      await result.current.softDeleteTransaction(id!);
    });

    // Toggle showDeleted on.
    act(() => {
      result.current.setShowDeleted(true);
    });

    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(result.current.transactions.length).toBe(1);
    expect(result.current.transactions[0]?.isDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// softDeleteTransaction
// ---------------------------------------------------------------------------

describe("softDeleteTransaction", () => {
  it("calls repository and refreshes list", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("To delete", "body");
    });

    const before = result.current.transactions.length;
    const id = result.current.transactions[0]!.id;

    await act(async () => {
      await result.current.softDeleteTransaction(id);
    });

    expect(result.current.transactions.length).toBe(before - 1);
  });
});

// ---------------------------------------------------------------------------
// softDeleteAllTransactions
// ---------------------------------------------------------------------------

describe("softDeleteAllTransactions", () => {
  it("bulk-deletes all transactions and refreshes the list", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Tx1", "body1");
      await result.current.addManualTransaction("Tx2", "body2");
    });

    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(result.current.transactions.length).toBe(2);

    await act(async () => {
      await result.current.softDeleteAllTransactions();
    });

    expect(result.current.transactions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addManualTransaction
// ---------------------------------------------------------------------------

describe("addManualTransaction", () => {
  it("creates transaction with packageName='Manual'", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("My title", "My description");
    });

    const tx = result.current.transactions[0];
    expect(tx?.packageName).toBe("Manual");
    expect(tx?.notificationTitle).toBe("My title");
    expect(tx?.notificationBody).toBe("My description");
  });

  it("auto-tags the transaction with 'AddedManually'", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Tagged tx", "body");
    });

    const tx = result.current.transactions[0];
    expect(tx?.transactionTags.length).toBe(1);
  });

  it("persists optional amount, currency, and isCash", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Cash tx", "body", 100, "EUR", true);
    });

    const tx = result.current.transactions[0];
    expect(tx?.amount).toBe(100);
    expect(tx?.currency).toBe("EUR");
    expect(tx?.isCash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exportTransactions – JSON
// ---------------------------------------------------------------------------

describe("exportTransactions('json')", () => {
  it("produces indented JSON of non-deleted transactions", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Export me", "body");
    });

    // Soft-delete a second transaction so we can verify it is excluded.
    await act(async () => {
      await result.current.addManualTransaction("Deleted", "body2");
    });

    await act(async () => {
      await result.current.loadTransactions();
    });

    const deletedId = result.current.transactions.find(
      (t) => t.notificationTitle === "Deleted"
    )?.id;
    expect(deletedId).toBeDefined();

    await act(async () => {
      await result.current.softDeleteTransaction(deletedId!);
    });

    let jsonContent = "";
    await act(async () => {
      jsonContent = await result.current.exportTransactions("json");
    });

    // Must be valid JSON.
    const parsed = JSON.parse(jsonContent) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    // Only the non-deleted transaction is exported.
    expect(parsed.length).toBe(1);
    // Must be indented (contains newlines).
    expect(jsonContent).toContain("\n");

    const row = parsed[0] as Record<string, unknown>;
    // All canonical CSV column names must appear in the JSON.
    expect(row).toHaveProperty("Id");
    expect(row).toHaveProperty("ReceivedAt");
    expect(row).toHaveProperty("NotificationTitle", "Export me");
    expect(row).toHaveProperty("PackageName", "Manual");
    expect(row).toHaveProperty("IsDeleted", 0);
  });

  it("calls the share function with the json content", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Share test", "body");
    });

    await act(async () => {
      await result.current.exportTransactions("json");
    });

    expect(shareMock.fn).toHaveBeenCalledOnce();
    const [title, text] = shareMock.fn.mock.calls[0] as [string, string];
    expect(title).toBe("transactions.json");
    expect(text).toContain("Share test");
  });
});

// ---------------------------------------------------------------------------
// exportTransactions – CSV
// ---------------------------------------------------------------------------

describe("exportTransactions('csv')", () => {
  it("produces CSV with correct headers", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("CSV tx", "body");
    });

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    const headerLine = csvContent.split("\n")[0];
    expect(headerLine).toBe(
      "Id,ReceivedAt,NotificationTitle,NotificationBody,PackageName,Amount,Currency,IsCash,Tags,IsDeleted"
    );
  });

  it("includes a data row for each non-deleted transaction", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Row1", "b1");
      await result.current.addManualTransaction("Row2", "b2");
    });

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    const lines = csvContent.split("\n");
    // Header + 2 data rows.
    expect(lines.length).toBe(3);
  });

  it("has tags as semicolon-separated values in the Tags column", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    // addManualTransaction auto-tags with AddedManually (tagId expected in CSV).
    await act(async () => {
      await result.current.addManualTransaction("Tagged CSV tx", "body");
    });

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    const dataLine = csvContent.split("\n")[1] ?? "";
    const columns = dataLine.split(",");
    // Tags column is at index 8.
    const tagsColumn = columns[8] ?? "";
    // Should be a numeric tagId (at least one digit).
    expect(tagsColumn).toMatch(/^\d+/);
  });
});

// ---------------------------------------------------------------------------
// checkDuplicate
// ---------------------------------------------------------------------------

describe("checkDuplicate", () => {
  it("returns false when no matching transaction exists", async () => {
    const db = await makeDb();
    const result = await setup(db);

    const isDuplicate = result.current.checkDuplicate(
      "title",
      "body",
      "com.example",
      new Date().toISOString()
    );
    expect(isDuplicate).toBe(false);
  });

  it("delegates to repository existsDuplicate and returns true on match", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // Insert a transaction with a known receivedAt.
    const receivedAt = "2024-06-01T12:00:00.000Z";

    await act(async () => {
      await result.current.addManualTransaction("Dup title", "Dup body");
    });

    // Manually update receivedAt to a known value using the db directly.
    db.run("UPDATE Transactions SET ReceivedAt = ?", [receivedAt]);

    const isDuplicate = result.current.checkDuplicate(
      "Dup title",
      "Dup body",
      "Manual",
      receivedAt
    );
    expect(isDuplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addTagToTransaction / removeTagFromTransaction / searchTags
// ---------------------------------------------------------------------------

describe("tag management", () => {
  it("addTagToTransaction links a tag to a transaction", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Tag me", "body");
    });

    const txId = result.current.transactions[0]!.id;

    await act(async () => {
      await result.current.addTagToTransaction(txId, "NewTag");
    });

    // Reload to see updated tags.
    await act(async () => {
      await result.current.loadTransactions();
    });

    const tx = result.current.transactions[0];
    // addManualTransaction adds AddedManually + addTagToTransaction adds NewTag
    expect(tx?.transactionTags.length).toBe(2);
  });

  it("removeTagFromTransaction unlinks a tag from a transaction", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Untag me", "body");
    });

    await act(async () => {
      await result.current.loadTransactions();
    });

    const tx = result.current.transactions[0]!;
    const tagId = tx.transactionTags[0]!.tagId;

    act(() => {
      result.current.removeTagFromTransaction(tx.id, tagId);
    });

    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(result.current.transactions[0]?.transactionTags.length).toBe(0);
  });

  it("searchTags returns matching tags", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // Create a transaction to ensure 'AddedManually' tag exists.
    await act(async () => {
      await result.current.addManualTransaction("Tag search test", "body");
    });

    const tags = result.current.searchTags("Added");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]?.name).toBe("AddedManually");
  });

  it("searchTags returns empty array for queries shorter than 2 chars", async () => {
    const db = await makeDb();
    const result = await setup(db);

    const tags = result.current.searchTags("A");
    expect(tags).toEqual([]);
  });
});
