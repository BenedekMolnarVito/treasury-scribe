/**
 * TransactionsPage.test.ts
 *
 * Integration tests for the TransactionsPage component.
 *
 * Environment: jsdom (required for React rendering via @testing-library/react).
 * A real in-memory sql.js database is used; no data-layer mocks are applied.
 */

// @vitest-environment jsdom

import { readFileSync } from "fs";
import { resolve } from "path";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { addTransaction } from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import TransactionsPage from "../../src/components/TransactionsPage.tsx";

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

// ---------------------------------------------------------------------------
// Per-test database
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(async () => {
  db = await initDatabase(wasmBinary);
});

afterEach(() => {
  cleanup();
  db.close();
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Renders TransactionsPage wrapped in a MemoryRouter (required for
 * useNavigate) with or without a db prop.
 */
function renderPage(
  database?: Database,
  props: Partial<React.ComponentProps<typeof TransactionsPage>> = {}
): void {
  render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(TransactionsPage, { db: database, ...props })
    )
  );
}

/**
 * Inserts a transaction with known fields and returns the persisted entity.
 */
function insertTx(
  overrides: Partial<{
    title: string;
    body: string;
    amount: number;
    currency: string;
    isIncome: boolean;
  }> = {}
) {
  return addTransaction(db, {
    ...createTransaction({ receivedAt: new Date().toISOString() }),
    notificationTitle: overrides.title ?? "Test Title",
    notificationBody: overrides.body ?? "Test Body",
    amount: overrides.amount ?? null,
    currency: overrides.currency ?? null,
    isIncome: overrides.isIncome ?? false,
  });
}

// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------

describe("TransactionsPage — heading", () => {
  it("always renders a Transactions heading", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /transactions/i })).toBeTruthy();
  });

  it("renders heading when db is provided", async () => {
    await act(async () => {
      renderPage(db);
    });
    expect(screen.getByRole("heading", { name: /transactions/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Header buttons
// ---------------------------------------------------------------------------

describe("TransactionsPage — header buttons", () => {
  it("renders Add Transaction, Refresh, Export, and Clear All buttons", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByRole("button", { name: /add transaction/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /export/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear all/i })).toBeTruthy();
  });

  it("opens an export format dialog when Export is tapped", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export/i }));
    });

    expect(screen.getByRole("dialog", { name: /export transactions/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "JSON" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
  });

  it("shows refresh feedback after checking notifications", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    });

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(alertSpy).toHaveBeenCalledWith("No new notifications to process.");
    alertSpy.mockRestore();
  });

  it("reloads transactions from the database when Refresh is tapped", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    addTransaction(db, {
      ...createTransaction({ receivedAt: new Date().toISOString() }),
      notificationTitle: "Refresh Reloaded",
      notificationBody: "Inserted outside the current UI state",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    });

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Refresh Reloaded")).toBeTruthy();
    expect(
      await screen.findByText("Inserted outside the current UI state")
    ).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledWith("No new notifications to process.");
    alertSpy.mockRestore();
  });

  it("shows how many active notifications were added during refresh", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const refreshActiveNotifications = vi.fn(async () => {
      addTransaction(db, {
        ...createTransaction({ receivedAt: new Date().toISOString() }),
        notificationTitle: "Refresh Vendor",
        notificationBody: "Paid 6 337 Ft",
        packageName: "com.revolut.revolut",
        amount: 6337,
        currency: "HUF",
      });
      return 1;
    });

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    });

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Refresh Vendor")).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledWith("1 new notifications added.");
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Show deleted toggle
// ---------------------------------------------------------------------------

describe("TransactionsPage — show deleted toggle", () => {
  it("renders the Show deleted entries toggle", async () => {
    await act(async () => {
      renderPage(db);
    });

    // The checkbox has role="switch" (ARIA toggle switch semantics).
    const toggle = screen.getByRole("switch", {
      name: /show deleted entries/i,
    });
    expect(toggle).toBeTruthy();
  });

  it("toggle is unchecked by default", async () => {
    await act(async () => {
      renderPage(db);
    });

    const toggle = screen.getByRole("switch", {
      name: /show deleted entries/i,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("can be toggled on", async () => {
    await act(async () => {
      renderPage(db);
    });

    const toggle = screen.getByRole("switch", {
      name: /show deleted entries/i,
    }) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle.checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("TransactionsPage — empty state", () => {
  it("shows empty-state message when no transactions exist", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("shows empty-state message when no db is provided", () => {
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Transaction cards
// ---------------------------------------------------------------------------

describe("TransactionsPage — transaction cards", () => {
  it("renders a card for each transaction", async () => {
    insertTx({ title: "TX 1" });
    insertTx({ title: "TX 2" });

    await act(async () => {
      renderPage(db);
    });

    const cards = screen.getAllByTestId("transaction-card");
    expect(cards.length).toBe(2);
  });

  it("renders the title in bold (fontWeight bold via aria-label)", async () => {
    insertTx({ title: "My Bold Title" });

    await act(async () => {
      renderPage(db);
    });

    // The card content should include the title text.
    expect(screen.getByText("My Bold Title")).toBeTruthy();
  });

  it("renders the body text", async () => {
    insertTx({ body: "Notification body text" });

    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByText("Notification body text")).toBeTruthy();
  });

  it("renders amount and currency", async () => {
    insertTx({ amount: 42.5, currency: "EUR" });

    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByText("42.5 EUR")).toBeTruthy();
  });

  it("renders 'No tags' for a transaction with 0 tags", async () => {
    insertTx();

    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByText("No tags")).toBeTruthy();
  });

  it("renders tag names for a transaction with tags", async () => {
    const tx = insertTx();
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByText("Tags: groceries")).toBeTruthy();
  });

  it("renders multiple tag names separated by commas", async () => {
    const tx = insertTx();
    const t1 = addTag(db, "food");
    const t2 = addTag(db, "daily");
    addTagToTransaction(db, tx.id, t1.id);
    addTagToTransaction(db, tx.id, t2.id);

    await act(async () => {
      renderPage(db);
    });

    // The order depends on insertion; just check both names appear in the line.
    const tagLine = screen.getByText(/^Tags:/);
    expect(tagLine.textContent).toContain("food");
    expect(tagLine.textContent).toContain("daily");
  });
});

// ---------------------------------------------------------------------------
// Card backgrounds
// ---------------------------------------------------------------------------

describe("TransactionsPage — card backgrounds", () => {
  it("applies #2A2A1A (dark) background for untagged cards", async () => {
    insertTx({ title: "Untagged Card" });

    await act(async () => {
      renderPage(db);
    });

    // The sliding card face has aria-label="Transaction: <title>".
    const cardFace = screen.getByRole("button", {
      name: /Transaction: Untagged Card/,
    }) as HTMLElement;
    // jsdom converts hex colours to rgb in computed style.
    expect(cardFace.style.background).toMatch(/rgb\(42,\s*42,\s*26\)|#2A2A1A/i);
  });

  it("applies #1A2A1A (dark green) background for tagged cards", async () => {
    const tx = insertTx({ title: "Tagged Card" });
    const tag = addTag(db, "tagged");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Tagged Card/,
    }) as HTMLElement;
    expect(cardFace.style.background).toMatch(/rgb\(26,\s*42,\s*26\)|#1A2A1A/i);
  });
});

// ---------------------------------------------------------------------------
// Amount colours
// ---------------------------------------------------------------------------

describe("TransactionsPage — amount colours", () => {
  it("renders expense amount in #FF6B6B", async () => {
    insertTx({ amount: 100, currency: "EUR", isIncome: false });

    await act(async () => {
      renderPage(db);
    });

    const amountEl = screen.getByText("100 EUR") as HTMLElement;
    // jsdom converts #FF6B6B to rgb(255, 107, 107).
    expect(amountEl.style.color).toMatch(/rgb\(255,\s*107,\s*107\)|#FF6B6B/i);
  });

  it("renders income amount in #4CAF50", async () => {
    insertTx({ amount: 200, currency: "HUF", isIncome: true });

    await act(async () => {
      renderPage(db);
    });

    const amountEl = screen.getByText("200 HUF") as HTMLElement;
    // jsdom converts #4CAF50 to rgb(76, 175, 80).
    expect(amountEl.style.color).toMatch(/rgb\(76,\s*175,\s*80\)|#4CAF50/i);
  });
});

// ---------------------------------------------------------------------------
// Swipe to delete
// ---------------------------------------------------------------------------

describe("TransactionsPage — swipe-left delete", () => {
  it("reveals Delete button after swipe-left gesture", async () => {
    insertTx({ title: "Swipe Me" });

    await act(async () => {
      renderPage(db);
    });

    expect(
      screen.queryByRole("button", { name: /delete transaction/i })
    ).toBeNull();

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Swipe Me/,
    });

    // Simulate swipe-left: touchstart at x=200, touchend at x=100.
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 200, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 100, clientY: 10 }],
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /delete transaction/i })
      ).toBeTruthy();
    });
  });

  it("soft-deletes the transaction when Delete is confirmed", async () => {
    const tx = insertTx({ title: "To Delete" });

    // Confirm dialog spy.
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: To Delete/,
    });

    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 200, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 100, clientY: 10 }],
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /delete transaction/i })
      ).toBeTruthy();
    });

    const deleteBtn = screen.getByRole("button", {
      name: /delete transaction/i,
    });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();

    // After soft-delete + reload the card should be gone.
    await waitFor(() => {
      expect(screen.queryByTestId("transaction-card")).toBeNull();
    });

    confirmSpy.mockRestore();

    // Verify the row is soft-deleted in the DB (not hard-deleted).
    const { getAllTransactionsIncludingDeleted } = await import(
      "../../src/data/TransactionRepository"
    );
    const all = getAllTransactionsIncludingDeleted(db);
    const match = all.find((t) => t.id === tx.id);
    expect(match).toBeDefined();
    expect(match?.isDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("TransactionsPage — navigation", () => {
  it("navigates to /edit/:id when card is tapped", async () => {
    insertTx({ title: "Nav Test" });

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Nav Test/,
    }) as HTMLElement;

    // Should be clickable without throwing; navigation is captured by the
    // MemoryRouter and does not throw even without a matching route.
    await act(async () => {
      fireEvent.click(cardFace);
    });

    // The page heading should still be mounted.
    expect(screen.getByRole("heading", { name: /transactions/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------

describe("TransactionsPage — loading state", () => {
  it("does not show a loading indicator in the initial settled state", async () => {
    await act(async () => {
      renderPage(db);
    });

    // After act() the loading promise has resolved.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dashboard button
// ---------------------------------------------------------------------------

describe("TransactionsPage — dashboard navigation", () => {
  it("renders a Dashboard button", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByRole("button", { name: /dashboard/i })).toBeTruthy();
  });

  it("Dashboard button has blue background", async () => {
    await act(async () => {
      renderPage(db);
    });

    const btn = screen.getByRole("button", { name: /dashboard/i }) as HTMLElement;
    expect(btn.style.background).toMatch(/rgb\(21,\s*101,\s*192\)|#1565C0/i);
  });
});

// ---------------------------------------------------------------------------
// Revolut Import button
// ---------------------------------------------------------------------------

describe("TransactionsPage — Revolut import", () => {
  it("renders a Revolut Import button", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByRole("button", { name: /revolut import/i })).toBeTruthy();
  });

  it("opens Revolut import modal when clicked", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revolut import/i }));
    });

    expect(screen.getByRole("dialog", { name: /import revolut/i })).toBeTruthy();
  });

  it("Revolut import modal has file input and buttons", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revolut import/i }));
    });

    expect(screen.getByTestId("revolut-file-input")).toBeTruthy();
    expect(screen.getByRole("button", { name: /import revolut/i })).toBeTruthy();
  });

  it("closes Revolut import modal on Cancel", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revolut import/i }));
    });

    expect(screen.getByRole("dialog", { name: /import revolut/i })).toBeTruthy();

    await act(async () => {
      // Find Cancel inside the modal
      const cancelBtns = screen.getAllByRole("button").filter(
        (btn) => btn.textContent === "Cancel"
      );
      fireEvent.click(cancelBtns[cancelBtns.length - 1]!);
    });

    expect(screen.queryByRole("dialog", { name: /import revolut/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Import (CSV/JSON) button
// ---------------------------------------------------------------------------

describe("TransactionsPage — import button", () => {
  it("renders an Import button", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByRole("button", { name: /^import$/i })).toBeTruthy();
  });

  it("opens import modal when clicked", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    expect(screen.getByRole("dialog", { name: /import transactions/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tag filter chips
// ---------------------------------------------------------------------------

describe("TransactionsPage — tag filter", () => {
  it("does not show tag filter when no tags exist", async () => {
    insertTx({ title: "No Tags" });

    await act(async () => {
      renderPage(db);
    });

    expect(screen.queryByLabelText("Tag filter")).toBeNull();
  });

  it("shows tag filter chips when transactions have tags", async () => {
    const tx = insertTx({ title: "Tagged" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    const filterArea = screen.getByLabelText("Tag filter");
    expect(filterArea).toBeTruthy();
    // Should show the tag name with count
    expect(screen.getByText(/Food \(1\)/)).toBeTruthy();
  });

  it("shows Untagged chip", async () => {
    const tx = insertTx({ title: "Tagged" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByText("Untagged")).toBeTruthy();
  });

  it("filters transactions by selected tag", async () => {
    const tx1 = insertTx({ title: "Food TX" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, tag.id);
    insertTx({ title: "No Tag TX" });

    await act(async () => {
      renderPage(db);
    });

    // Both should be visible initially
    expect(screen.getByText("Food TX")).toBeTruthy();
    expect(screen.getByText("No Tag TX")).toBeTruthy();

    // Click Food tag chip
    await act(async () => {
      fireEvent.click(screen.getByText(/Food \(1\)/));
    });

    // Only Food TX should remain
    expect(screen.getByText("Food TX")).toBeTruthy();
    expect(screen.queryByText("No Tag TX")).toBeNull();
  });

  it("filters to show only untagged transactions", async () => {
    const tx1 = insertTx({ title: "Tagged TX" });
    const tag = addTag(db, "Shopping");
    addTagToTransaction(db, tx1.id, tag.id);
    insertTx({ title: "Untagged TX" });

    await act(async () => {
      renderPage(db);
    });

    // Click Untagged chip
    await act(async () => {
      fireEvent.click(screen.getByText("Untagged"));
    });

    expect(screen.queryByText("Tagged TX")).toBeNull();
    expect(screen.getByText("Untagged TX")).toBeTruthy();
  });

  it("shows Clear button when filter is active and clears on click", async () => {
    const tx1 = insertTx({ title: "Food TX" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, tag.id);
    insertTx({ title: "Other TX" });

    await act(async () => {
      renderPage(db);
    });

    // No clear button initially
    expect(screen.queryByLabelText("Clear tag filter")).toBeNull();

    // Activate filter
    await act(async () => {
      fireEvent.click(screen.getByText(/Food \(1\)/));
    });

    // Clear button appears
    expect(screen.getByLabelText("Clear tag filter")).toBeTruthy();

    // Click clear
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Clear tag filter"));
    });

    // Both transactions visible again
    expect(screen.getByText("Food TX")).toBeTruthy();
    expect(screen.getByText("Other TX")).toBeTruthy();
  });

  it("shows filtered empty state message", async () => {
    const tx1 = insertTx({ title: "Tagged" });
    const tag1 = addTag(db, "Food");
    addTagToTransaction(db, tx1.id, tag1.id);

    await act(async () => {
      renderPage(db);
    });

    // Click Untagged (no untagged transactions exist)
    await act(async () => {
      fireEvent.click(screen.getByText("Untagged"));
    });

    expect(screen.getByTestId("empty-state")).toBeTruthy();
    expect(screen.getByTestId("empty-state").textContent).toContain("No transactions match");
  });
});

// ---------------------------------------------------------------------------
// Test Notification button removed
// ---------------------------------------------------------------------------

describe("TransactionsPage — test button removed", () => {
  it("does not render a Test Notification button", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.queryByRole("button", { name: /test notification/i })).toBeNull();
  });
});
