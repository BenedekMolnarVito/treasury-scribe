/**
 * EditTransactionPage.test.ts
 *
 * Integration tests for the EditTransactionPage component.
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
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import { addTransaction, getTransactionById } from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import EditTransactionPage from "../../src/components/EditTransactionPage.tsx";

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
 * Renders EditTransactionPage inside a MemoryRouter pointing at /edit/:id.
 *
 * @param txId - Transaction id to include in the URL.
 * @param database - Optional db prop; defaults to the per-test `db`.
 */
function renderPage(txId: number, database: Database = db): void {
  render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`/edit/${txId}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/edit/:id",
          element: React.createElement(EditTransactionPage, { db: database }),
        }),
        React.createElement(Route, {
          path: "/transactions",
          element: React.createElement("div", {
            "data-testid": "transactions-page",
          }),
        })
      )
    )
  );
}

/** Insert a transaction and return its id. */
function insertTx(
  overrides: Partial<{
    title: string;
    body: string;
    isCash: boolean;
    isIncome: boolean;
    amount: number | null;
    currency: string | null;
    receivedAt: string;
  }> = {}
): number {
  const tx = addTransaction(db, {
    ...createTransaction({ receivedAt: overrides.receivedAt ?? new Date().toISOString() }),
    notificationTitle: overrides.title ?? "Test Title",
    notificationBody: overrides.body ?? "Test Body",
    isCash: overrides.isCash ?? false,
    isIncome: overrides.isIncome ?? false,
    amount: overrides.amount !== undefined ? overrides.amount : null,
    currency: overrides.currency !== undefined ? overrides.currency : null,
  });
  return tx.id;
}

// ---------------------------------------------------------------------------
// Presence of core UI elements
// ---------------------------------------------------------------------------

describe("core fields", () => {
  it("renders the page heading", async () => {
    const id = insertTx();
    renderPage(id);
    expect(screen.getByRole("heading", { name: /edit transaction/i })).toBeTruthy();
  });

  it("renders Title input", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("input-title")).toBeTruthy()
    );
  });

  it("renders Description textarea", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("input-description")).toBeTruthy()
    );
  });

  it("renders Cash Transaction toggle", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("toggle-cash")).toBeTruthy()
    );
  });

  it("renders Income toggle", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("toggle-income")).toBeTruthy()
    );
  });

  it("renders Save Changes button", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("btn-save")).toBeTruthy()
    );
  });

  it("renders Add Tag button", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("btn-add-tag")).toBeTruthy()
    );
  });

  it("renders Amount input", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("input-amount")).toBeTruthy()
    );
  });

  it("renders Currency input", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("input-currency")).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Pre-populated values
// ---------------------------------------------------------------------------

describe("pre-populated values", () => {
  it("populates Title input with notificationTitle", async () => {
    const id = insertTx({ title: "My Title" });
    renderPage(id);
    await waitFor(() => {
      const input = screen.getByTestId("input-title") as HTMLInputElement;
      expect(input.value).toBe("My Title");
    });
  });

  it("populates Description textarea with notificationBody", async () => {
    const id = insertTx({ body: "My Body" });
    renderPage(id);
    await waitFor(() => {
      const ta = screen.getByTestId("input-description") as HTMLTextAreaElement;
      expect(ta.value).toBe("My Body");
    });
  });

  it("pre-checks Cash Transaction toggle when isCash is true", async () => {
    const id = insertTx({ isCash: true });
    renderPage(id);
    await waitFor(() => {
      const cb = screen.getByTestId("toggle-cash");
      expect(cb.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("pre-checks Income toggle when isIncome is true", async () => {
    const id = insertTx({ isIncome: true });
    renderPage(id);
    await waitFor(() => {
      const cb = screen.getByTestId("toggle-income");
      expect(cb.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("populates Amount input with the stored amount", async () => {
    const id = insertTx({ amount: 1599, currency: "HUF" });
    renderPage(id);
    await waitFor(() => {
      const input = screen.getByTestId("input-amount") as HTMLInputElement;
      expect(input.value).toBe("1599");
    });
  });

  it("populates Currency input with the stored currency", async () => {
    const id = insertTx({ amount: 25.5, currency: "USD" });
    renderPage(id);
    await waitFor(() => {
      const input = screen.getByTestId("input-currency") as HTMLInputElement;
      expect(input.value).toBe("USD");
    });
  });

  it("leaves Amount input empty when the transaction has no amount", async () => {
    const id = insertTx({ amount: null });
    renderPage(id);
    await waitFor(() => {
      const input = screen.getByTestId("input-amount") as HTMLInputElement;
      expect(input.value).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// Current tags list
// ---------------------------------------------------------------------------

describe("current tags", () => {
  it("shows existing tags with Remove buttons", async () => {
    const id = insertTx();
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, id, tag.id);

    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${tag.id}`)).toBeTruthy()
    );
  });

  it("removes a tag when Remove button is clicked", async () => {
    const id = insertTx();
    const tag = addTag(db, "removable");
    addTagToTransaction(db, id, tag.id);

    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${tag.id}`)).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId(`remove-tag-${tag.id}`));
    });

    await waitFor(() =>
      expect(screen.queryByTestId(`remove-tag-${tag.id}`)).toBeNull()
    );
  });
});

// ---------------------------------------------------------------------------
// Word cloud
// ---------------------------------------------------------------------------

describe("word cloud", () => {
  it("shows up to 5 pill buttons for the top-5 common tags", async () => {
    // Create 6 tags and link them to transactions so they have usage counts.
    const tags = ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f"].map(
      (name) => addTag(db, name)
    );
    tags.forEach((tag, i) => {
      // Use count proportional to index so top-5 are predictable.
      for (let j = 0; j < 6 - i; j++) {
        const txId = insertTx();
        addTagToTransaction(db, txId, tag.id);
      }
    });

    const id = insertTx();
    renderPage(id);

    await waitFor(() => {
      const cloud = screen.getByTestId("word-cloud");
      const pills = cloud.querySelectorAll("button");
      expect(pills.length).toBeLessThanOrEqual(5);
      expect(pills.length).toBeGreaterThan(0);
    });
  });

  it("adds a tag from the word cloud when pill is clicked", async () => {
    const tag = addTag(db, "quick-tag");
    const otherTx = insertTx();
    addTagToTransaction(db, otherTx, tag.id);

    const id = insertTx();
    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId(`quick-tag-${tag.id}`)).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId(`quick-tag-${tag.id}`));
    });

    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${tag.id}`)).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Tag search (debounced)
// ---------------------------------------------------------------------------

describe("tag search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Renders the page and flushes initial effects (loadTransaction +
   * loadRecentTags) synchronously so the form is visible before fake timers
   * are involved.
   */
  async function renderAndFlush(txId: number): Promise<void> {
    renderPage(txId);
    // Flush all pending micro-tasks and effects.
    await act(async () => {
      vi.runAllTimers();
    });
  }

  it("does not show suggestions for queries under 2 characters", async () => {
    addTag(db, "alpha");
    const id = insertTx();

    await renderAndFlush(id);

    expect(screen.getByTestId("input-tag-search")).toBeTruthy();

    act(() => {
      fireEvent.change(screen.getByTestId("input-tag-search"), {
        target: { value: "a" },
      });
    });
    act(() => vi.runAllTimers());

    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
  });

  it("shows suggestions after 300 ms debounce for 2+ char query", async () => {
    addTag(db, "beta");
    const id = insertTx();

    await renderAndFlush(id);

    act(() => {
      fireEvent.change(screen.getByTestId("input-tag-search"), {
        target: { value: "be" },
      });
    });

    // Before debounce fires — no suggestions.
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();

    act(() => vi.advanceTimersByTime(300));

    expect(screen.getByTestId("tag-suggestions")).toBeTruthy();
  });

  it("adds a tag when a suggestion is clicked", async () => {
    const tag = addTag(db, "gamma");
    const id = insertTx();

    await renderAndFlush(id);

    act(() => {
      fireEvent.change(screen.getByTestId("input-tag-search"), {
        target: { value: "ga" },
      });
    });
    act(() => vi.advanceTimersByTime(300));

    expect(screen.getByTestId(`suggestion-${tag.id}`)).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId(`suggestion-${tag.id}`));
    });

    expect(screen.getByTestId(`remove-tag-${tag.id}`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Add Tag button
// ---------------------------------------------------------------------------

describe("Add Tag button", () => {
  it("creates a new tag and shows it in current tags", async () => {
    const id = insertTx();
    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId("input-tag-search")).toBeTruthy()
    );

    act(() => {
      fireEvent.change(screen.getByTestId("input-tag-search"), {
        target: { value: "new-tag" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-add-tag"));
    });

    await waitFor(() =>
      expect(screen.getByText("new-tag")).toBeTruthy()
    );
  });

  it("clears the search input after adding a tag", async () => {
    const id = insertTx();
    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId("input-tag-search")).toBeTruthy()
    );

    act(() => {
      fireEvent.change(screen.getByTestId("input-tag-search"), {
        target: { value: "clear-me" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-add-tag"));
    });

    await waitFor(() => {
      const input = screen.getByTestId(
        "input-tag-search"
      ) as HTMLInputElement;
      expect(input.value).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// Save Changes
// ---------------------------------------------------------------------------

describe("Save Changes", () => {
  it("navigates back to '/' when Save Changes is clicked", async () => {
    const id = insertTx();
    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId("btn-save")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("btn-save"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("transactions-page")).toBeTruthy()
    );
  });

  it("persists title edits before navigating back", async () => {
    const id = insertTx({ title: "Old Title" });
    renderPage(id);

    await waitFor(() => {
      const input = screen.getByTestId("input-title") as HTMLInputElement;
      expect(input.value).toBe("Old Title");
    });

    act(() => {
      fireEvent.change(screen.getByTestId("input-title"), {
        target: { value: "New Title" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-save"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("transactions-page")).toBeTruthy()
    );

    // Re-render the edit page to confirm persistence.
    cleanup();

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/edit/${id}`] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/edit/:id",
            element: React.createElement(EditTransactionPage, { db }),
          })
        )
      )
    );

    await waitFor(() => {
      const input = screen.getByTestId("input-title") as HTMLInputElement;
      expect(input.value).toBe("New Title");
    });
  });
});

// ---------------------------------------------------------------------------
// No-db fallback
// ---------------------------------------------------------------------------

describe("no db prop", () => {
  it("renders fallback message when db is not provided", () => {
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/edit/1"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/edit/:id",
            element: React.createElement(EditTransactionPage),
          })
        )
      )
    );
    expect(screen.getByTestId("no-db-message")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Split Transaction
// ---------------------------------------------------------------------------

describe("split transaction", () => {
  it("shows Split Transaction button when amount is set", async () => {
    const id = insertTx({ amount: 5000, currency: "HUF" });
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("btn-split")).toBeTruthy()
    );
  });

  it("does not show Split Transaction button when amount is null", async () => {
    const id = insertTx({ amount: null });
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("btn-save")).toBeTruthy()
    );
    expect(screen.queryByTestId("btn-split")).toBeNull();
  });

  it("opens SplitTransactionModal when Split button is clicked", async () => {
    const id = insertTx({ amount: 3000, currency: "HUF" });
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("btn-split")).toBeTruthy()
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-split"));
    });
    expect(screen.getByRole("dialog", { name: /split transaction/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// receivedAt (Date & Time field)
// ---------------------------------------------------------------------------

describe("receivedAt field", () => {
  it("renders the Date & Time input", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("input-received-at")).toBeTruthy()
    );
  });

  it("populates the Date & Time input from the stored transaction", async () => {
    const storedAt = "2024-06-15T14:30:00.000Z";
    const id = insertTx({ receivedAt: storedAt });
    renderPage(id);
    await waitFor(() => {
      const input = screen.getByTestId("input-received-at") as HTMLInputElement;
      // The input shows a datetime-local value (first 16 chars of the ISO string).
      expect(input.value).toBe(storedAt.slice(0, 16));
    });
  });

  it("persists an updated receivedAt on save", async () => {
    const originalAt = "2024-01-01T10:00:00.000Z";
    const id = insertTx({ receivedAt: originalAt });
    renderPage(id);

    await waitFor(() =>
      expect(screen.getByTestId("input-received-at")).toBeTruthy()
    );

    // Change the date/time field.
    act(() => {
      fireEvent.change(screen.getByTestId("input-received-at"), {
        target: { value: "2024-06-20T08:45" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-save"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("transactions-page")).toBeTruthy()
    );

    // Confirm the updated value is persisted in the database.
    const saved = getTransactionById(db, id);
    expect(saved).not.toBeNull();
    // Verify both the date and time are correctly persisted.
    expect(saved!.receivedAt).toContain("2024-06-20");
    expect(saved!.receivedAt).toContain("08:45");
  });
});

// ---------------------------------------------------------------------------
// FR7: OS swipe-back + visible Back button
// ---------------------------------------------------------------------------

// vi.mock is hoisted to module level by Vitest, so mock variables must be
// declared with vi.hoisted() to be in scope when the factory runs.
const { mockRemove, mockAddListener } = vi.hoisted(() => {
  const mockRemove = vi.fn();
  const mockAddListener = vi.fn(() => Promise.resolve({ remove: mockRemove }));
  return { mockRemove, mockAddListener };
});

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: mockAddListener,
  },
}));

describe("FR7 – OS back-button listener and visible Back button", () => {
  beforeEach(() => {
    mockRemove.mockClear();
    mockAddListener.mockClear();
  });

  it("renders a visible Back button with data-testid='edit-back-button'", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("edit-back-button")).toBeTruthy()
    );
  });

  it("clicking the Back button navigates to /transactions", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(screen.getByTestId("edit-back-button")).toBeTruthy()
    );
    act(() => {
      fireEvent.click(screen.getByTestId("edit-back-button"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("transactions-page")).toBeTruthy()
    );
  });

  it("registers a backButton listener on mount", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() =>
      expect(mockAddListener).toHaveBeenCalledWith(
        "backButton",
        expect.any(Function)
      )
    );
  });

  it("removes the backButton listener on unmount", async () => {
    const id = insertTx();
    renderPage(id);
    // Wait for listener to be registered (and promise to resolve).
    await waitFor(() =>
      expect(mockAddListener).toHaveBeenCalledWith(
        "backButton",
        expect.any(Function)
      )
    );
    // Flush microtasks so the addListener promise resolves and handle is stored.
    await act(async () => {});
    cleanup();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// FR8: Default / Exception toggle
// ---------------------------------------------------------------------------

import { setTransactionException } from "../../src/data/TransactionRepository";

describe("FR8 – Default/Exception toggle on EditTransactionPage", () => {
  it("renders the tag-mode-toggle, tag-mode-default, tag-mode-exception elements", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() => expect(screen.getByTestId("tag-mode-toggle")).toBeTruthy());
    expect(screen.getByTestId("tag-mode-default")).toBeTruthy();
    expect(screen.getByTestId("tag-mode-exception")).toBeTruthy();
  });

  it("defaults to Default mode (tag-mode-default aria-pressed=true)", async () => {
    const id = insertTx();
    renderPage(id);
    await waitFor(() => {
      const defaultBtn = screen.getByTestId("tag-mode-default") as HTMLButtonElement;
      expect(defaultBtn.getAttribute("aria-pressed")).toBe("true");
    });
    const exceptionBtn = screen.getByTestId("tag-mode-exception") as HTMLButtonElement;
    expect(exceptionBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects existing exception state when transaction already has ExcludeFromAutoLearn=true", async () => {
    const id = insertTx();
    // Set exception mode in DB before rendering
    setTransactionException(db, id, true);
    renderPage(id);
    await waitFor(() => {
      const exceptionBtn = screen.getByTestId("tag-mode-exception") as HTMLButtonElement;
      expect(exceptionBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("flipping to Exception clears assigned tags and persists", async () => {
    const id = insertTx();
    // Add a tag to the transaction
    const { addTag: repoAddTag, addTagToTransaction: repoAddTagToTx } = await import(
      "../../src/data/TagRepository"
    );
    const tag = repoAddTag(db, "TestTag");
    repoAddTagToTx(db, id, tag.id);

    renderPage(id);

    await waitFor(() => expect(screen.getByTestId("tag-mode-exception")).toBeTruthy());

    // Click Exception
    act(() => {
      fireEvent.click(screen.getByTestId("tag-mode-exception"));
    });

    // Tags should be cleared from the UI
    await waitFor(() => {
      const currentTagsDiv = screen.getByTestId("current-tags");
      // No tag chips for TestTag
      expect(currentTagsDiv.querySelectorAll("[data-testid^='tag-chip-']").length).toBe(0);
    });

    // DB should also have no tags for this transaction
    const fetched = getTransactionById(db, id)!;
    expect(fetched.excludeFromAutoLearn).toBe(true);
    expect(fetched.transactionTags).toHaveLength(0);
  });

  it("flipping back to Default does NOT restore tags", async () => {
    const id = insertTx();
    const { addTag: repoAddTag, addTagToTransaction: repoAddTagToTx } = await import(
      "../../src/data/TagRepository"
    );
    const tag = repoAddTag(db, "AnotherTag");
    repoAddTagToTx(db, id, tag.id);

    renderPage(id);
    await waitFor(() => expect(screen.getByTestId("tag-mode-exception")).toBeTruthy());

    // Flip to Exception (clears tags)
    act(() => {
      fireEvent.click(screen.getByTestId("tag-mode-exception"));
    });
    await waitFor(() => {
      expect(getTransactionById(db, id)!.transactionTags).toHaveLength(0);
    });

    // Flip back to Default
    act(() => {
      fireEvent.click(screen.getByTestId("tag-mode-default"));
    });

    // Tags remain empty (not restored)
    await waitFor(() => {
      expect(getTransactionById(db, id)!.transactionTags).toHaveLength(0);
    });
  });
});
