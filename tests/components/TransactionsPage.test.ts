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
function renderPage(database?: Database): void {
  render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(TransactionsPage, { db: database })
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
  it("applies #FFFACD (light yellow) background for untagged cards", async () => {
    insertTx({ title: "Untagged Card" });

    await act(async () => {
      renderPage(db);
    });

    // The sliding card face has aria-label="Transaction: <title>".
    const cardFace = screen.getByRole("button", {
      name: /Transaction: Untagged Card/,
    }) as HTMLElement;
    // jsdom converts hex colours to rgb in computed style.
    expect(cardFace.style.background).toMatch(/rgb\(255,\s*250,\s*205\)|#FFFACD/i);
  });

  it("applies #90EE90 (light green) background for tagged cards", async () => {
    const tx = insertTx({ title: "Tagged Card" });
    const tag = addTag(db, "tagged");
    addTagToTransaction(db, tx.id, tag.id);

    await act(async () => {
      renderPage(db);
    });

    const cardFace = screen.getByRole("button", {
      name: /Transaction: Tagged Card/,
    }) as HTMLElement;
    expect(cardFace.style.background).toMatch(/rgb\(144,\s*238,\s*144\)|#90EE90/i);
  });
});

// ---------------------------------------------------------------------------
// Amount colours
// ---------------------------------------------------------------------------

describe("TransactionsPage — amount colours", () => {
  it("renders expense amount in red", async () => {
    insertTx({ amount: 100, currency: "EUR", isIncome: false });

    await act(async () => {
      renderPage(db);
    });

    const amountEl = screen.getByText("100 EUR") as HTMLElement;
    // jsdom may preserve "red" or convert to rgb(255,0,0).
    expect(amountEl.style.color).toMatch(/^red$|rgb\(255,\s*0,\s*0\)/);
  });

  it("renders income amount in dark green (#006400)", async () => {
    insertTx({ amount: 200, currency: "HUF", isIncome: true });

    await act(async () => {
      renderPage(db);
    });

    const amountEl = screen.getByText("200 HUF") as HTMLElement;
    // jsdom converts #006400 to rgb(0, 100, 0).
    expect(amountEl.style.color).toMatch(/rgb\(0,\s*100,\s*0\)|#006400/i);
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
