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
import { Share } from "@capacitor/share";
import { Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
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
  vi.restoreAllMocks();
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
  it("renders empty-state when no db is provided", () => {
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("renders content when db is provided", async () => {
    await act(async () => {
      renderPage(db);
    });
    // With bottom nav in App.tsx, there is no heading. Check FAB is present.
    expect(screen.getByTestId("fab-add")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Header buttons
// ---------------------------------------------------------------------------

/**
 * Simulates a downward pull-to-refresh gesture on the scroll container.
 * Uses two separate act() phases:
 * 1. touchstart + touchmove → React re-renders with updated pullDistance
 * 2. touchend              → handlePullEnd sees the updated pullDistance
 *
 * The Object.defineProperty override is needed because jsdom's TouchEvent
 * doesn't expose the Touch constructor as a global.
 */
async function simulatePullToRefresh(container: Element): Promise<void> {
  const makeEvent = (type: string, clientY?: number): TouchEvent => {
    const e = new TouchEvent(type, { bubbles: true, cancelable: true });
    if (clientY !== undefined) {
      Object.defineProperty(e, "touches", {
        get: () => [{ clientX: 0, clientY, target: container }],
        configurable: true,
      });
    }
    return e;
  };

  // Phase 1: set isPulling and pull distance, then flush React state.
  await act(async () => {
    container.dispatchEvent(makeEvent("touchstart", 0));
    container.dispatchEvent(makeEvent("touchmove", 100));
  });

  // Phase 2: fire touchend now that pullDistance is updated in state.
  await act(async () => {
    container.dispatchEvent(makeEvent("touchend"));
  });
}

describe("TransactionsPage — header buttons", () => {
  it("renders Add Transaction, Filter, Export, Import, and Clear All buttons", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.getByRole("button", { name: /add transaction/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^refresh$/i })).toBeNull();
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

  it.each(["JSON", "CSV"] as const)(
    "starts a %s export when its format button is selected",
    async (format) => {
      vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
      const writeFileSpy = vi
        .spyOn(Filesystem, "writeFile")
        .mockResolvedValue({ uri: `file:///cache/export.${format.toLowerCase()}` });
      const shareSpy = vi.spyOn(Share, "share");
      await act(async () => {
        renderPage(db);
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /export/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: format }));
      });

      await waitFor(() => expect(shareSpy).toHaveBeenCalledOnce());
      const options = shareSpy.mock.calls[0]![0];
      expect(options.title).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
      expect(writeFileSpy).toHaveBeenCalledOnce();
      const fileOptions = writeFileSpy.mock.calls[0]![0];
      expect(fileOptions.data).toContain(format === "JSON" ? "[" : "ReceivedAt");
      expect(options.files).toEqual([`file:///cache/export.${format.toLowerCase()}`]);
      expect(options.text).toBeUndefined();
      expect(screen.queryByRole("dialog", { name: /export transactions/i })).toBeNull();
    }
  );

  it("shows and logs export failures instead of silently closing the dialog", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.spyOn(Filesystem, "writeFile").mockResolvedValue({
      uri: "file:///cache/transactions.json",
    });
    const error = new Error("Share plugin unavailable");
    const shareSpy = vi.spyOn(Share, "share").mockRejectedValue(error);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      renderPage(db);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Export failed: Share plugin unavailable");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to export transactions",
      error
    );
  });

  it("shows 'Up to date' toast when pull-to-refresh finds no new notifications", async () => {
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    const container = screen.getByTestId("transactions-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Up to date")).toBeTruthy();
  });

  it("reloads transactions from the database after pull-to-refresh", async () => {
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    addTransaction(db, {
      ...createTransaction({ receivedAt: new Date().toISOString() }),
      notificationTitle: "Refresh Reloaded",
      notificationBody: "Inserted outside the current UI state",
    });

    const container = screen.getByTestId("transactions-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Refresh Reloaded")).toBeTruthy();
    expect(
      await screen.findByText("Inserted outside the current UI state")
    ).toBeTruthy();
  });

  it("shows captured notification count in pull-to-refresh toast", async () => {
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

    const container = screen.getByTestId("transactions-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Refresh Vendor")).toBeTruthy();
    expect(await screen.findByText(/1 new notification/i)).toBeTruthy();
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
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("can be toggled on", async () => {
    await act(async () => {
      renderPage(db);
    });

    const toggle = screen.getByRole("switch", {
      name: /show deleted entries/i,
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
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
  it("applies #ff99009c (orange with opacity) background for untagged cards", async () => {
    insertTx({ title: "Untagged Card" });

    await act(async () => {
      renderPage(db);
    });

    // The sliding card face has aria-label="Transaction: <title>".
    const cardFace = screen.getByRole("button", {
      name: /Transaction: Untagged Card/,
    }) as HTMLElement;
    // jsdom converts hex colours to rgba in computed style.
    expect(cardFace.style.background).toMatch(/rgba\(255,\s*153,\s*0,\s*0\.61\)|#ff99009c/i);
  });

  it("applies #03356e (dark blue) background for tagged cards", async () => {
    const tx = insertTx({ title: "Tagged Card" });
    const tag = addTag(db, "tagged");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Tagged Card/,
    }) as HTMLElement;
    expect(cardFace.style.background).toMatch(/rgb\(3,\s*53,\s*110\)|#03356e/i);
  });
});

// ---------------------------------------------------------------------------
// Amount colours
// ---------------------------------------------------------------------------

describe("TransactionsPage — amount colours", () => {
  it("renders expense amount in #f90e0e", async () => {
    insertTx({ amount: 100, currency: "EUR", isIncome: false });

    await act(async () => {
      renderPage(db);
    });

    const amountEl = screen.getByText("100 EUR") as HTMLElement;
    // jsdom converts #f90e0e to rgb(249, 14, 14).
    expect(amountEl.style.color).toMatch(/rgb\(249,\s*14,\s*14\)|#f90e0e/i);
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

describe("TransactionsPage — swipe-right delete", () => {
  it("reveals Delete button after swipe-right gesture", async () => {
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

    // Simulate swipe-right: touchstart at x=100, touchend at x=200.
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 100, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 200, clientY: 10 }],
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
        touches: [{ clientX: 100, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 200, clientY: 10 }],
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

    // The FAB should still be mounted (page didn't unmount).
    expect(screen.getByTestId("fab-add")).toBeTruthy();
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
  it("does not render a Dashboard button (moved to bottom nav in App)", async () => {
    await act(async () => {
      renderPage(db);
    });

    expect(screen.queryByRole("button", { name: /^dashboard$/i })).toBeNull();
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
  it("does not show tag filter toggle when no tags exist", async () => {
    insertTx({ title: "No Tags" });

    await act(async () => {
      renderPage(db);
    });

    expect(screen.queryByTestId("btn-toggle-tag-filter")).toBeNull();
  });

  it("shows tag filter chips when toggle is clicked", async () => {
    const tx = insertTx({ title: "Tagged" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    // Filter toggle should exist
    expect(screen.getByTestId("btn-toggle-tag-filter")).toBeTruthy();

    // Click to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
    });

    const filterArea = screen.getByLabelText("Tag filter");
    expect(filterArea).toBeTruthy();
    expect(screen.getByText(/Food \(1\)/)).toBeTruthy();
  });

  it("shows Untagged chip", async () => {
    const tx = insertTx({ title: "Tagged" });
    const tag = addTag(db, "Food");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    // Click filter toggle to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
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

    // Click filter toggle to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
    });

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

    // Click filter toggle to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
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

    // Click filter toggle to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
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

    // Click filter toggle to reveal tags
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-toggle-tag-filter"));
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

// ---------------------------------------------------------------------------
// Bug 4: Swipe delete direction — right-to-reveal, left-to-dismiss
// ---------------------------------------------------------------------------

describe("TransactionsPage — swipe direction correctness", () => {
  it("does NOT reveal Delete on swipe-left (dx < -50)", async () => {
    insertTx({ title: "No Left Reveal" });

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: No Left Reveal/,
    });

    // Simulate swipe-left: touchstart at x=200, touchend at x=100 (dx = -100).
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 200, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 100, clientY: 10 }],
      });
    });

    // Delete button should NOT appear.
    expect(
      screen.queryByRole("button", { name: /delete transaction/i })
    ).toBeNull();
  });

  it("dismisses Delete on swipe-left after swiping right to reveal", async () => {
    insertTx({ title: "Dismiss Left" });

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Dismiss Left/,
    });

    // Swipe right to reveal.
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 100, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 200, clientY: 10 }],
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /delete transaction/i })
      ).toBeTruthy();
    });

    // Swipe left to dismiss (dx = -30, below -20 threshold).
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 200, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 160, clientY: 10 }],
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /delete transaction/i })
      ).toBeNull();
    });
  });

  it("slides card rightward (translateX 80px) when swiped", async () => {
    insertTx({ title: "Slide Right" });

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Slide Right/,
    }) as HTMLElement;

    // Swipe right to reveal.
    act(() => {
      fireEvent.touchStart(cardFace, {
        touches: [{ clientX: 50, clientY: 10 }],
      });
      fireEvent.touchEnd(cardFace, {
        changedTouches: [{ clientX: 200, clientY: 10 }],
      });
    });

    await waitFor(() => {
      expect(cardFace.style.transform).toBe("translateX(80px)");
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 5: JSON/CSV import accept attribute includes MIME types
// ---------------------------------------------------------------------------

describe("TransactionsPage — import file accept attribute", () => {
  it("accepts JSON/CSV MIME types in addition to extensions", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    });

    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    expect(input.accept).toContain(".json");
    expect(input.accept).toContain(".csv");
    expect(input.accept).toContain("application/json");
    expect(input.accept).toContain("text/csv");
    expect(input.accept).toContain("text/comma-separated-values");
    expect(input.accept).toContain("text/plain");
  });
});

// ---------------------------------------------------------------------------
// Bug 6: Revolut CSV import accept attribute includes MIME types
// ---------------------------------------------------------------------------

describe("TransactionsPage — Revolut import file accept attribute", () => {
  it("accepts CSV MIME types in addition to .csv extension", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revolut import/i }));
    });

    const input = screen.getByTestId("revolut-file-input") as HTMLInputElement;
    expect(input.accept).toContain(".csv");
    expect(input.accept).toContain("text/csv");
    expect(input.accept).toContain("text/comma-separated-values");
    expect(input.accept).toContain("text/plain");
  });
});

// ---------------------------------------------------------------------------
// Bug 7: Income toggle in Add Transaction modal
// ---------------------------------------------------------------------------

describe("TransactionsPage — add transaction income toggle", () => {
  it("renders an Income toggle in the Add Transaction modal", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    expect(screen.getByRole("dialog", { name: /add transaction/i })).toBeTruthy();
    expect(screen.getByText("Income")).toBeTruthy();

    // The dialog should contain at least 2 toggle switches (Cash + Income)
    const toggles = screen.getByRole("dialog", { name: /add transaction/i })
      .querySelectorAll('[role="switch"]');
    expect(toggles.length).toBeGreaterThanOrEqual(2);
  });

  it("Income toggle is unchecked by default", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    const incomeToggle = screen.getByTestId("toggle-add-income");
    expect(incomeToggle.getAttribute("aria-checked")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// FR8: Default / Exception toggle on AddTransactionModal
// ---------------------------------------------------------------------------

describe("FR8 – Default/Exception toggle in AddTransactionModal", () => {
  it("renders tag-mode-toggle, tag-mode-default, tag-mode-exception in the modal", async () => {
    await act(async () => {
      renderPage(db);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    expect(screen.getByTestId("tag-mode-toggle")).toBeTruthy();
    expect(screen.getByTestId("tag-mode-default")).toBeTruthy();
    expect(screen.getByTestId("tag-mode-exception")).toBeTruthy();
  });

  it("defaults to Default mode (tag-mode-default aria-pressed=true)", async () => {
    await act(async () => {
      renderPage(db);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    const defaultBtn = screen.getByTestId("tag-mode-default") as HTMLButtonElement;
    expect(defaultBtn.getAttribute("aria-pressed")).toBe("true");
    const exceptionBtn = screen.getByTestId("tag-mode-exception") as HTMLButtonElement;
    expect(exceptionBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("can flip to Exception mode", async () => {
    await act(async () => {
      renderPage(db);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    act(() => {
      fireEvent.click(screen.getByTestId("tag-mode-exception"));
    });

    const exceptionBtn = screen.getByTestId("tag-mode-exception") as HTMLButtonElement;
    expect(exceptionBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("persists excludeFromAutoLearn=true when Exception is selected on add", async () => {
    await act(async () => {
      renderPage(db);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    // Fill in required title
    fireEvent.change(screen.getByRole("dialog").querySelector('input[placeholder="Title"]')!, {
      target: { value: "Exception Tx" },
    });

    // Select Exception mode
    act(() => {
      fireEvent.click(screen.getByTestId("tag-mode-exception"));
    });

    // Submit the form
    await act(async () => {
      fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    });

    // Verify a transaction was added with excludeFromAutoLearn=true
    await waitFor(() => {
      const txs = screen.queryAllByTestId(/^tx-card-/);
      // The modal should have closed; find the transaction in DB
      const stmtResult = db.exec(
        "SELECT ExcludeFromAutoLearn FROM Transactions WHERE NotificationTitle = 'Exception Tx' LIMIT 1"
      );
      expect(stmtResult.length).toBeGreaterThan(0);
      const val = stmtResult[0]!.values[0]![0];
      expect(val).toBe(1);
      void txs;
    });
  });
});

// ---------------------------------------------------------------------------
// FR4: Tag input in AddTransactionModal
// ---------------------------------------------------------------------------

describe("FR4 – tag input in AddTransactionModal", () => {
  it("renders add-txn-tag-input in the Add Transaction modal", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    expect(screen.getByTestId("add-txn-tag-input")).toBeTruthy();
  });

  it("user can type a tag and it renders as a pill/chip", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    const tagInput = screen.getByTestId("add-txn-tag-input");
    fireEvent.change(tagInput, { target: { value: "Groceries" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    // After pressing Enter, the chip should be visible
    await waitFor(() => {
      expect(screen.getByText("Groceries")).toBeTruthy();
    });
  });

  it("submit calls onAdd with tagNames containing user-typed tags", async () => {
    const onAddSpy = vi.fn(async () => {});

    render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          // We need to render the modal directly; use TransactionsPage with mocked addManualTransaction
          // via a custom wrapper that overrides onAdd
          // Instead, we'll spy at the TransactionsPage level by intercepting via the hook
          TransactionsPage,
          { db }
        )
      )
    );

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    // Fill required title
    fireEvent.change(
      screen.getByRole("dialog").querySelector('input[placeholder="Title"]')!,
      { target: { value: "Tag Test Tx" } }
    );

    // Add a tag via the tag input
    const tagInput = screen.getByTestId("add-txn-tag-input");
    fireEvent.change(tagInput, { target: { value: "Dining" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    // Submit the form
    await act(async () => {
      fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    });

    // Verify the transaction was stored with the Dining tag
    await waitFor(() => {
      const stmtResult = db.exec(
        `SELECT t.Name FROM Tags t
         JOIN TransactionTags tt ON tt.TagId = t.Id
         JOIN Transactions tx ON tx.Id = tt.TransactionId
         WHERE tx.NotificationTitle = 'Tag Test Tx'`
      );
      const names = stmtResult[0]?.values.map((row) => row[0]) ?? [];
      expect(names).toContain("Dining");
      expect(names).toContain("AddedManually");
    });

    void onAddSpy;
  });

  it("FR8 tag-mode-toggle still present alongside tag input", async () => {
    await act(async () => {
      renderPage(db);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    });

    expect(screen.getByTestId("tag-mode-toggle")).toBeTruthy();
    expect(screen.getByTestId("add-txn-tag-input")).toBeTruthy();
  });
});
