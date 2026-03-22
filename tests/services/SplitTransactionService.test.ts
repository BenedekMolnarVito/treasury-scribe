/**
 * SplitTransactionService.test.ts
 *
 * Unit / integration tests for the split-transaction service.
 * Each test gets its own isolated in-memory database.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import {
  addTransaction,
  getTransactionById,
  softDeleteTransaction,
} from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import {
  splitTransaction,
  type SplitByFraction,
  type SplitByAmount,
} from "../../src/services/SplitTransactionService";

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
// Helpers
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = "2024-06-15T12:00:00.000Z";

function insertParent(overrides: Record<string, unknown> = {}) {
  return addTransaction(
    db,
    createTransaction({
      notificationTitle: "Coffee Shop",
      notificationBody: "Payment 30 EUR",
      packageName: "com.bank",
      receivedAt: BASE_TIMESTAMP,
      amount: 30,
      currency: "EUR",
      isIncome: false,
      ...overrides,
    })
  );
}

// ---------------------------------------------------------------------------
// Fraction mode – happy path
// ---------------------------------------------------------------------------

describe("splitTransaction – fraction mode", () => {
  it("splits correctly with 2 fractions", () => {
    const parent = insertParent({ amount: 100 });
    const spec: SplitByFraction = { mode: "fraction", fractions: [0.4, 0.6] };

    const result = splitTransaction(db, parent.id, spec);

    expect(result.children).toHaveLength(2);
    expect(result.children[0].amount).toBe(40);
    expect(result.children[1].amount).toBe(60);
  });

  it("splits correctly with 3 fractions", () => {
    const parent = insertParent({ amount: 90 });
    const spec: SplitByFraction = { mode: "fraction", fractions: [0.5, 0.25, 0.25] };

    const result = splitTransaction(db, parent.id, spec);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].amount).toBe(45);
    expect(result.children[1].amount).toBe(22.5);
    expect(result.children[2].amount).toBe(22.5);
  });

  it("validates fractions sum to 1", () => {
    const parent = insertParent();
    const spec: SplitByFraction = { mode: "fraction", fractions: [0.3, 0.3] };

    expect(() => splitTransaction(db, parent.id, spec)).toThrow(
      /Fractions must sum to 1/
    );
  });

  it("rejects a single fraction", () => {
    const parent = insertParent();
    const spec: SplitByFraction = { mode: "fraction", fractions: [1.0] };

    expect(() => splitTransaction(db, parent.id, spec)).toThrow(
      /at least 2 fractions/
    );
  });
});

// ---------------------------------------------------------------------------
// Amount mode – happy path
// ---------------------------------------------------------------------------

describe("splitTransaction – amount mode", () => {
  it("splits correctly with explicit amounts + remainder", () => {
    const parent = insertParent({ amount: 100 });
    const spec: SplitByAmount = { mode: "amount", amounts: [30, 25] };

    const result = splitTransaction(db, parent.id, spec);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].amount).toBe(30);
    expect(result.children[1].amount).toBe(25);
    expect(result.children[2].amount).toBe(45);
  });

  it("validates amounts don't exceed parent", () => {
    const parent = insertParent({ amount: 50 });
    const spec: SplitByAmount = { mode: "amount", amounts: [30, 25] };

    expect(() => splitTransaction(db, parent.id, spec)).toThrow(
      /exceeds parent amount/
    );
  });

  it("rejects when remainder would be <= 0", () => {
    const parent = insertParent({ amount: 50 });
    const spec: SplitByAmount = { mode: "amount", amounts: [50] };

    expect(() => splitTransaction(db, parent.id, spec)).toThrow(
      /Remainder must be > 0/
    );
  });
});

// ---------------------------------------------------------------------------
// Parent soft-deletion
// ---------------------------------------------------------------------------

describe("splitTransaction – parent lifecycle", () => {
  it("soft-deletes the parent after split", () => {
    const parent = insertParent({ amount: 100 });
    splitTransaction(db, parent.id, { mode: "fraction", fractions: [0.5, 0.5] });

    const refreshedParent = getTransactionById(db, parent.id);
    expect(refreshedParent).not.toBeNull();
    expect(refreshedParent!.isDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Child titles
// ---------------------------------------------------------------------------

describe("splitTransaction – child titles", () => {
  it("children have correct titles (Split 1/2, Split 2/2)", () => {
    const parent = insertParent({ amount: 100, notificationTitle: "Grocery" });
    const result = splitTransaction(db, parent.id, {
      mode: "fraction",
      fractions: [0.5, 0.5],
    });

    expect(result.children[0].notificationTitle).toBe("Grocery (Split 1/2)");
    expect(result.children[1].notificationTitle).toBe("Grocery (Split 2/2)");
  });
});

// ---------------------------------------------------------------------------
// Tag inheritance
// ---------------------------------------------------------------------------

describe("splitTransaction – tag behaviour", () => {
  it("children inherit parent tags except AddedManually", () => {
    const parent = insertParent({ amount: 100 });
    const foodTag = addTag(db, "Food");
    const manualTag = addTag(db, "AddedManually");
    const monthlyTag = addTag(db, "Monthly");
    addTagToTransaction(db, parent.id, foodTag.id);
    addTagToTransaction(db, parent.id, manualTag.id);
    addTagToTransaction(db, parent.id, monthlyTag.id);

    // Re-fetch parent so tags are loaded
    const result = splitTransaction(db, parent.id, {
      mode: "fraction",
      fractions: [0.5, 0.5],
    });

    for (const child of result.children) {
      const tagNames = child.transactionTags.map((tt) => tt.tagName);
      expect(tagNames).toContain("Food");
      expect(tagNames).toContain("Monthly");
      expect(tagNames).not.toContain("AddedManually");
    }
  });

  it("children get SplitFrom tag", () => {
    const parent = insertParent({ amount: 100 });
    const result = splitTransaction(db, parent.id, {
      mode: "fraction",
      fractions: [0.5, 0.5],
    });

    for (const child of result.children) {
      const tagNames = child.transactionTags.map((tt) => tt.tagName);
      expect(tagNames).toContain(`SplitFrom:${parent.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation – edge cases
// ---------------------------------------------------------------------------

describe("splitTransaction – validation", () => {
  it("rejects split on non-existent transaction", () => {
    expect(() =>
      splitTransaction(db, 9999, { mode: "fraction", fractions: [0.5, 0.5] })
    ).toThrow(/does not exist/);
  });

  it("rejects split on already-deleted transaction", () => {
    const parent = insertParent({ amount: 100 });
    softDeleteTransaction(db, parent.id);

    expect(() =>
      splitTransaction(db, parent.id, { mode: "fraction", fractions: [0.5, 0.5] })
    ).toThrow(/already deleted/);
  });

  it("rejects split when parent amount is null", () => {
    const parent = insertParent({ amount: null });

    expect(() =>
      splitTransaction(db, parent.id, { mode: "fraction", fractions: [0.5, 0.5] })
    ).toThrow(/has no amount/);
  });
});

// ---------------------------------------------------------------------------
// Children field inheritance
// ---------------------------------------------------------------------------

describe("splitTransaction – field inheritance", () => {
  it("children copy currency, receivedAt, packageName, notificationBody from parent", () => {
    const parent = insertParent({
      amount: 100,
      currency: "HUF",
      receivedAt: "2024-03-10T08:00:00.000Z",
      packageName: "com.revolut",
      notificationBody: "Paid 100 HUF",
    });

    const result = splitTransaction(db, parent.id, {
      mode: "fraction",
      fractions: [0.5, 0.5],
    });

    for (const child of result.children) {
      expect(child.currency).toBe("HUF");
      expect(child.receivedAt).toBe("2024-03-10T08:00:00.000Z");
      expect(child.packageName).toBe("com.revolut");
      expect(child.notificationBody).toBe("Paid 100 HUF");
      expect(child.isDeleted).toBe(false);
    }
  });
});
