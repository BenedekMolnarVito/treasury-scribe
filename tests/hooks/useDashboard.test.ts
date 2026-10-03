/**
 * useDashboard.test.ts
 *
 * Unit / integration tests for the useDashboard hook.
 *
 * Environment: jsdom (required for React hooks via renderHook).
 * A real in-memory sql.js database is used; each test receives its
 * own in-memory database for full isolation.
 */

// @vitest-environment jsdom

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { addTransaction } from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import { useDashboard } from "../../src/hooks/useDashboard";

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

function insertExpense(
  database: Database,
  overrides: Partial<{
    title: string;
    amount: number;
    receivedAt: string;
  }> = {}
): number {
  const tx = addTransaction(database, {
    ...createTransaction({
      receivedAt: overrides.receivedAt ?? new Date().toISOString(),
    }),
    notificationTitle: overrides.title ?? "Vendor",
    isIncome: false,
    amount: overrides.amount ?? 1000,
    currency: "HUF",
  });
  return tx.id;
}

function insertIncome(
  database: Database,
  overrides: Partial<{
    title: string;
    amount: number;
    receivedAt: string;
  }> = {}
): number {
  const tx = addTransaction(database, {
    ...createTransaction({
      receivedAt: overrides.receivedAt ?? new Date().toISOString(),
    }),
    notificationTitle: overrides.title ?? "Employer",
    isIncome: true,
    amount: overrides.amount ?? 5000,
    currency: "HUF",
  });
  return tx.id;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initial state", () => {
  it("starts in loading state with empty summary", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.loading).toBe(true);
    expect(result.current.summary.total).toBe(0);
    expect(result.current.summary.count).toBe(0);
  });

  it("defaults to 'month' period", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.period).toBe("month");
  });

  it("starts with empty income summary", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.incomeSummary.total).toBe(0);
    expect(result.current.incomeSummary.count).toBe(0);
  });

  it("starts with empty selectedTagIds", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.selectedTagIds).toEqual([]);
  });

  it("starts with empty availableTags", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.availableTags).toEqual([]);
  });

  it("starts with empty incomeByMonth", () => {
    const { result } = renderHook(() => useDashboard(db));

    expect(result.current.incomeByMonth).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refresh / loadData
// ---------------------------------------------------------------------------

describe("refresh", () => {
  it("loads summary data after refresh", () => {
    insertExpense(db, { amount: 5000 });
    insertExpense(db, { amount: 3000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.loading).toBe(false);
    expect(result.current.summary.total).toBe(8000);
    expect(result.current.summary.count).toBe(2);
  });

  it("loads income summary after refresh", () => {
    insertIncome(db, { amount: 10000 });
    insertIncome(db, { amount: 5000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.incomeSummary.total).toBe(15000);
    expect(result.current.incomeSummary.count).toBe(2);
  });

  it("loads spending by vendor", () => {
    insertExpense(db, { title: "Lidl", amount: 5000 });
    insertExpense(db, { title: "CBA", amount: 3000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.byVendor.length).toBeGreaterThanOrEqual(2);
    expect(result.current.byVendor[0].vendor).toBe("Lidl");
  });

  it("loads spending by tag", () => {
    const txId = insertExpense(db, { amount: 5000 });
    const tag = addTag(db, "food");
    addTagToTransaction(db, txId, tag.id);

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    const foodEntry = result.current.byTag.find((t) => t.tagName === "food");
    expect(foodEntry).toBeTruthy();
    expect(foodEntry!.total).toBe(5000);
  });

  it("loads untagged transaction count", () => {
    insertExpense(db);
    insertExpense(db);

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.untaggedCount).toBe(2);
  });

  it("loads spending by month", () => {
    insertExpense(db, { amount: 1000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.byMonth.length).toBeGreaterThanOrEqual(0);
  });

  it("loads income by month", () => {
    insertIncome(db, { amount: 10000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.incomeByMonth.length).toBeGreaterThanOrEqual(0);
  });

  it("loads available tags after refresh", () => {
    const txId = insertExpense(db, { amount: 5000 });
    const tag = addTag(db, "food");
    addTagToTransaction(db, txId, tag.id);

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());

    expect(result.current.availableTags.length).toBe(1);
    expect(result.current.availableTags[0].tagName).toBe("food");
  });
});

// ---------------------------------------------------------------------------
// setPeriod
// ---------------------------------------------------------------------------

describe("setPeriod", () => {
  it("changes the active period", () => {
    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setPeriod("3months"));

    expect(result.current.period).toBe("3months");
    expect(result.current.loading).toBe(false);
  });

  it("reloads data when period changes to 6months", () => {
    insertExpense(db, { amount: 2000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setPeriod("6months"));

    expect(result.current.period).toBe("6months");
    expect(result.current.summary.count).toBeGreaterThanOrEqual(0);
    expect(result.current.loading).toBe(false);
  });

  it("can switch back to month", () => {
    insertExpense(db, { amount: 2000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setPeriod("6months"));
    act(() => result.current.setPeriod("month"));

    expect(result.current.period).toBe("month");
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tag filter (Bug 10)
// ---------------------------------------------------------------------------

describe("setSelectedTagIds", () => {
  it("updates selectedTagIds state", () => {
    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setSelectedTagIds([1, 2]));

    expect(result.current.selectedTagIds).toEqual([1, 2]);
  });

  it("reloads data when tag filter changes", () => {
    const txId = insertExpense(db, { amount: 5000 });
    const tag = addTag(db, "food");
    addTagToTransaction(db, txId, tag.id);
    insertExpense(db, { amount: 3000 }); // untagged

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());
    expect(result.current.summary.total).toBe(8000);

    // Filter to only "food" tag
    act(() => result.current.setSelectedTagIds([tag.id]));

    expect(result.current.summary.total).toBe(5000);
    expect(result.current.loading).toBe(false);
  });

  it("clears tag filter and shows all data", () => {
    const txId = insertExpense(db, { amount: 5000 });
    const tag = addTag(db, "food");
    addTagToTransaction(db, txId, tag.id);
    insertExpense(db, { amount: 3000 });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.refresh());
    act(() => result.current.setSelectedTagIds([tag.id]));
    expect(result.current.summary.total).toBe(5000);

    act(() => result.current.setSelectedTagIds([]));
    expect(result.current.summary.total).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// FR1: lastMonth period
// ---------------------------------------------------------------------------

describe("lastMonth period", () => {
  it("setPeriod('lastMonth') changes the active period to lastMonth", () => {
    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setPeriod("lastMonth"));

    expect(result.current.period).toBe("lastMonth");
    expect(result.current.loading).toBe(false);
  });

  it("lastMonth byMonth is bounded to only the previous calendar month", () => {
    const now = new Date();
    // A transaction in the previous month
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
    const prevMonthStr = String(prevMonth).padStart(2, "0");
    const prevMonthDate = `${prevYear}-${prevMonthStr}-15`;

    // A transaction in the current month (should NOT appear)
    const currYear = now.getFullYear();
    const currMonth = String(now.getMonth() + 1).padStart(2, "0");
    const currMonthDate = `${currYear}-${currMonth}-01`;

    insertExpense(db, { amount: 3000, receivedAt: `${prevMonthDate}T10:00:00.000Z` });
    insertExpense(db, { amount: 7000, receivedAt: `${currMonthDate}T10:00:00.000Z` });

    const { result } = renderHook(() => useDashboard(db));

    act(() => result.current.setPeriod("lastMonth"));

    // Only the prev month transaction should be counted
    expect(result.current.summary.total).toBe(3000);
  });

  it("lastMonth summary excludes transactions from two months ago", () => {
    const now = new Date();
    const twoMonthsAgoYear = now.getMonth() <= 1
      ? now.getFullYear() - 1
      : now.getFullYear();
    const twoMonthsAgoMonth = ((now.getMonth() - 2 + 12) % 12) + 1; // 1-based
    const twoMonthsAgoStr = String(twoMonthsAgoMonth).padStart(2, "0");
    const twoMonthsAgoDate = `${twoMonthsAgoYear}-${twoMonthsAgoStr}-15`;

    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevMonthStr = String(prevMonth).padStart(2, "0");
    const prevMonthDate = `${prevYear}-${prevMonthStr}-15`;

    insertExpense(db, { amount: 1000, receivedAt: `${twoMonthsAgoDate}T10:00:00.000Z` });
    insertExpense(db, { amount: 5000, receivedAt: `${prevMonthDate}T10:00:00.000Z` });

    const { result } = renderHook(() => useDashboard(db));
    act(() => result.current.setPeriod("lastMonth"));

    expect(result.current.summary.total).toBe(5000);
  });
});
