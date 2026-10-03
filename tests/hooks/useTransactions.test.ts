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
import {
  addTransaction,
  softDeleteTransaction,
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
async function setup(
  db: Database,
  shareMock?: ReturnType<typeof makeShareMock>
) {
  const { result } = renderHook(() =>
    useTransactions(db, shareMock?.fn)
  );
  return result;
}

async function setupWithCallback(
  db: Database,
  onDatabaseChanged = vi.fn()
) {
  const { result } = renderHook(() =>
    useTransactions(db, undefined, onDatabaseChanged)
  );
  return { result, onDatabaseChanged };
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

  it("notifies the app when a manual transaction is added", async () => {
    const db = await makeDb();
    const { result, onDatabaseChanged } = await setupWithCallback(db);

    await act(async () => {
      await result.current.addManualTransaction("Callback test", "body");
    });

    expect(onDatabaseChanged).toHaveBeenCalledWith(db);
  });
});

// ---------------------------------------------------------------------------
// exportTransactions – JSON
// ---------------------------------------------------------------------------

describe("exportTransactions('json')", () => {
  it("produces indented JSON of all transactions including soft-deleted", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Export me", "body");
    });

    // Soft-delete a second transaction to verify it IS included with IsDeleted=1.
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
    // Both transactions are exported (active + soft-deleted).
    expect(parsed.length).toBe(2);
    // Must be indented (contains newlines).
    expect(jsonContent).toContain("\n");

    const activeRow = (parsed as Record<string, unknown>[]).find(
      (r) => r["NotificationTitle"] === "Export me"
    );
    expect(activeRow).toBeDefined();
    // All canonical CSV column names must appear in the JSON.
    expect(activeRow).toHaveProperty("Id");
    expect(activeRow).toHaveProperty("ReceivedAt");
    expect(activeRow).toHaveProperty("PackageName", "Manual");
    expect(activeRow).toHaveProperty("IsDeleted", 0);

    const deletedRow = (parsed as Record<string, unknown>[]).find(
      (r) => r["NotificationTitle"] === "Deleted"
    );
    expect(deletedRow).toBeDefined();
    expect(deletedRow).toHaveProperty("IsDeleted", 1);
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
    expect(title).toMatch(/^treasury-scribe-transactions_\d{8}_\d{6}\.json$/);
    expect(text).toContain("Share test");
  });

  it("exports an empty JSON array when there are no non-deleted transactions", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    let jsonContent = "";
    await act(async () => {
      jsonContent = await result.current.exportTransactions("json");
    });

    expect(jsonContent).toBe("[]");
    expect(shareMock.fn).toHaveBeenCalledOnce();
  });

  it("exports a stable snapshot even if new data is saved during sharing", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    shareMock.fn.mockImplementationOnce(async (_title: string, text: string) => {
      shareMock.calls.push({ title: "transactions.json", text });
      addTransaction(
        db,
        createTransaction({
          notificationTitle: "Late arrival",
          notificationBody: "Saved during export",
          packageName: "Manual",
          receivedAt: new Date().toISOString(),
        })
      );
    });

    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Snapshot base", "body");
    });

    let jsonContent = "";
    await act(async () => {
      jsonContent = await result.current.exportTransactions("json");
    });

    expect(jsonContent).toContain("Snapshot base");
    expect(jsonContent).not.toContain("Late arrival");

    await act(async () => {
      await result.current.loadTransactions();
    });

    expect(
      result.current.transactions.some(
        (tx) => tx.notificationTitle === "Late arrival"
      )
    ).toBe(true);
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
    // Should contain the human-readable tag name "AddedManually".
    expect(tagsColumn).toBe("AddedManually");
  });

  it("exports header-only CSV when there are no non-deleted transactions", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    expect(csvContent).toBe(
      "Id,ReceivedAt,NotificationTitle,NotificationBody,PackageName,Amount,Currency,IsCash,Tags,IsDeleted"
    );
    expect(shareMock.fn).toHaveBeenCalledOnce();
  });

  it("quotes title and body fields that contain commas", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Shop, Inc.", "Paid 1,000 Ft");
    });

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    expect(csvContent).toContain('"Shop, Inc."');
    expect(csvContent).toContain('"Paid 1,000 Ft"');
  });

  it("escapes semicolons inside individual tag names", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("Tagged edge", "body");
    });

    const txId = result.current.transactions[0]!.id;
    await act(async () => {
      await result.current.addTagToTransaction(txId, "food;drink");
      await result.current.loadTransactions();
    });

    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    expect(csvContent).toContain("food\\;drink");
  });

  it("calls the share function with a timestamped csv filename", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    await act(async () => {
      await result.current.addManualTransaction("CSV Export Filename", "body");
    });

    await act(async () => {
      await result.current.exportTransactions("csv");
    });

    expect(shareMock.fn).toHaveBeenCalledOnce();
    const [title] = shareMock.fn.mock.calls[0] as [string, string];
    expect(title).toMatch(/^treasury-scribe-transactions_\d{8}_\d{6}\.csv$/);
  });

  it("export includes soft-deleted rows with IsDeleted=1", async () => {
    const db = await makeDb();
    const shareMock = makeShareMock();
    const result = await setup(db, shareMock);

    // Add two transactions.
    await act(async () => {
      await result.current.addManualTransaction("Visible", "active body");
      await result.current.addManualTransaction("Hidden", "deleted body");
    });

    // Soft-delete the second one.
    await act(async () => {
      await result.current.loadTransactions();
    });
    const hiddenId = result.current.transactions.find(
      (t) => t.notificationTitle === "Hidden"
    )?.id;
    expect(hiddenId).toBeDefined();
    await act(async () => {
      await result.current.softDeleteTransaction(hiddenId!);
    });

    // Export CSV — the deleted row must appear with IsDeleted=1.
    let csvContent = "";
    await act(async () => {
      csvContent = await result.current.exportTransactions("csv");
    });

    const lines = csvContent.split("\n");
    // Header + 2 data rows (visible + deleted).
    expect(lines.length).toBe(3);
    // The deleted row contains IsDeleted=1 in the last column.
    const deletedLine = lines.find((l) => l.includes("Hidden")) ?? "";
    expect(deletedLine).toBeTruthy();
    expect(deletedLine.endsWith(",1")).toBe(true);
    // The active row contains IsDeleted=0.
    const visibleLine = lines.find((l) => l.includes("Visible")) ?? "";
    expect(visibleLine.endsWith(",0")).toBe(true);
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

// ---------------------------------------------------------------------------
// ingestNotification
// ---------------------------------------------------------------------------

describe("ingestNotification", () => {
  it("returns a Transaction and refreshes the list on a new unique notification", async () => {
    const db = await makeDb();
    const result = await setup(db);

    let tx: Awaited<ReturnType<typeof result.current.ingestNotification>>;
    await act(async () => {
      tx = await result.current.ingestNotification("Lidl", "Payment 500 HUF", "com.revolut.revolut");
    });

    expect(tx).not.toBeNull();
    expect(tx!.notificationTitle).toBe("Lidl");
    expect(result.current.transactions.length).toBe(1);
  });

  it("returns null and does not refresh the list when the notification is a duplicate", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // First ingestion to establish the existing record.
    await act(async () => {
      await result.current.ingestNotification("Lidl", "Payment 500 HUF", "com.revolut.revolut");
    });

    // Manually set a known receivedAt so the next call lands within the ±5 s window.
    db.run("UPDATE Transactions SET ReceivedAt = ?", [new Date().toISOString()]);

    let second: Awaited<ReturnType<typeof result.current.ingestNotification>>;
    await act(async () => {
      second = await result.current.ingestNotification("Lidl", "Payment 500 HUF", "com.revolut.revolut");
    });

    expect(second).toBeNull();
    // List must not grow — still 1 transaction.
    expect(result.current.transactions.length).toBe(1);
  });

  it("soft-deletes the new transaction when a matching soft-deleted tx already exists", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // Seed a soft-deleted transaction with a known title + body via the repository.
    const existing = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Netflix",
        notificationBody: "12 EUR charge",
        packageName: "com.revolut.revolut",
        receivedAt: new Date(Date.now() - 60_000).toISOString(),
      })
    );
    softDeleteTransaction(db, existing.id);

    let tx: Awaited<ReturnType<typeof result.current.ingestNotification>>;
    await act(async () => {
      tx = await result.current.ingestNotification("Netflix", "12 EUR charge", "com.revolut.revolut");
    });

    expect(tx).not.toBeNull();
    expect(tx!.isDeleted).toBe(true);
  });

  it("auto-tags the new transaction from the previous same-title transaction (excluding AddedManually)", async () => {
    const db = await makeDb();
    const result = await setup(db);

    // Seed a previous transaction with "Groceries" and "AddedManually" tags.
    const prev = addTransaction(
      db,
      createTransaction({
        notificationTitle: "Tesco",
        notificationBody: "3 200 HUF",
        packageName: "com.revolut.revolut",
        receivedAt: new Date(Date.now() - 120_000).toISOString(),
      })
    );
    const manualTag = addTag(db, "AddedManually");
    const groceriesTag = addTag(db, "Groceries");
    addTagToTransaction(db, prev.id, manualTag.id);
    addTagToTransaction(db, prev.id, groceriesTag.id);

    let tx: Awaited<ReturnType<typeof result.current.ingestNotification>>;
    await act(async () => {
      tx = await result.current.ingestNotification("Tesco", "3 200 HUF", "com.revolut.revolut");
    });

    expect(tx).not.toBeNull();
    const tagNames = tx!.transactionTags.map((tt) => tt.tagName);
    expect(tagNames).toContain("Groceries");
    expect(tagNames).not.toContain("AddedManually");
  });

  it("returns a Transaction with no tags when no previous same-title transaction exists", async () => {
    const db = await makeDb();
    const result = await setup(db);

    let tx: Awaited<ReturnType<typeof result.current.ingestNotification>>;
    await act(async () => {
      tx = await result.current.ingestNotification("BrandNewMerchant", null, "com.revolut.revolut");
    });

    expect(tx).not.toBeNull();
    expect(tx!.transactionTags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 7: addManualTransaction with isIncome parameter
// ---------------------------------------------------------------------------

describe("addManualTransaction with isIncome", () => {
  it("persists isIncome=true when passed", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction(
        "Income tx", "salary", 5000, "EUR", false, true
      );
    });

    const tx = result.current.transactions[0];
    expect(tx?.isIncome).toBe(true);
    expect(tx?.amount).toBe(5000);
    expect(tx?.currency).toBe("EUR");
    expect(tx?.isCash).toBe(false);
  });

  it("defaults isIncome to false when omitted", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction("Expense tx", "lunch", 15, "EUR");
    });

    const tx = result.current.transactions[0];
    expect(tx?.isIncome).toBe(false);
  });

  it("defaults isIncome to false when explicitly passed undefined", async () => {
    const db = await makeDb();
    const result = await setup(db);

    await act(async () => {
      await result.current.addManualTransaction(
        "Undef income", "body", 10, "HUF", false, undefined
      );
    });

    const tx = result.current.transactions[0];
    expect(tx?.isIncome).toBe(false);
  });
});
