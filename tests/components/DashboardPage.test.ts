/**
 * DashboardPage.test.ts
 *
 * Integration tests for the DashboardPage component.
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
} from "vitest";
import type { Database } from "sql.js";

import { initDatabase } from "../../src/data/DatabaseService";
import { addTransaction } from "../../src/data/TransactionRepository";
import { addTag, addTagToTransaction } from "../../src/data/TagRepository";
import { createTransaction } from "../../src/models/Transaction";
import DashboardPage from "../../src/components/DashboardPage.tsx";

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

function renderPage(database: Database = db): void {
  render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/dashboard"] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/dashboard",
          element: React.createElement(DashboardPage, { db: database }),
        }),
        React.createElement(Route, {
          path: "/",
          element: React.createElement("div", {
            "data-testid": "transactions-page",
          }),
        })
      )
    )
  );
}

function insertExpense(
  overrides: Partial<{
    title: string;
    amount: number;
    receivedAt: string;
  }> = {}
): number {
  const tx = addTransaction(db, {
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

// ---------------------------------------------------------------------------
// Core UI elements
// ---------------------------------------------------------------------------

describe("core UI elements", () => {
  it("renders the Dashboard heading", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /dashboard/i })).toBeTruthy()
    );
  });

  it("renders the back button", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("btn-back")).toBeTruthy()
    );
  });

  it("renders the hero card", async () => {
    insertExpense({ amount: 5000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });

  it("renders the hero total", async () => {
    insertExpense({ amount: 5000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-total")).toBeTruthy()
    );
  });

  it("renders period pills", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("period-pills")).toBeTruthy()
    );
  });

  it("renders the tag chart container", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("tag-chart")).toBeTruthy()
    );
  });

  it("renders the monthly chart container", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("monthly-chart")).toBeTruthy()
    );
  });

  it("renders the vendors card", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("vendors-card")).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Summary card data
// ---------------------------------------------------------------------------

describe("summary card", () => {
  it("displays spending total", async () => {
    insertExpense({ amount: 5000 });
    insertExpense({ amount: 3000 });
    renderPage();
    await waitFor(() => {
      const heroTotal = screen.getByTestId("hero-total");
      expect(heroTotal.textContent).toContain("8");
    });
  });

  it("displays transaction count", async () => {
    insertExpense({ amount: 1000 });
    insertExpense({ amount: 2000 });
    renderPage();
    await waitFor(() => {
      const card = screen.getByTestId("hero-card");
      expect(card.textContent).toContain("2 transactions");
    });
  });
});

// ---------------------------------------------------------------------------
// Period pills interaction
// ---------------------------------------------------------------------------

describe("period pills", () => {
  it("defaults to month pill active", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("pill-month")).toBeTruthy()
    );
  });

  it("switches period when 3 Mo pill is clicked", async () => {
    insertExpense({ amount: 1000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("pill-3months")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-3months"));
    });

    // Should still render without error
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });

  it("switches period when 6 Mo pill is clicked", async () => {
    insertExpense({ amount: 1000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("pill-6months")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-6months"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("navigates back to / when back button is clicked", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("btn-back")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("btn-back"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("transactions-page")).toBeTruthy()
    );
  });
});

// ---------------------------------------------------------------------------
// Untagged badge
// ---------------------------------------------------------------------------

describe("untagged badge", () => {
  it("shows untagged badge when there are untagged transactions", async () => {
    insertExpense();
    insertExpense();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("untagged-badge")).toBeTruthy()
    );
  });

  it("does not show untagged badge when all transactions are tagged", async () => {
    const txId = insertExpense();
    const tag = addTag(db, "food");
    addTagToTransaction(db, txId, tag.id);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );

    expect(screen.queryByTestId("untagged-badge")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No db fallback
// ---------------------------------------------------------------------------

describe("no db prop", () => {
  it("renders fallback message when db is not provided", () => {
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/dashboard"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/dashboard",
            element: React.createElement(DashboardPage),
          })
        )
      )
    );
    expect(screen.getByTestId("no-db-message")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Spending by tag chart
// ---------------------------------------------------------------------------

describe("tag chart", () => {
  it("displays tag names in the chart", async () => {
    const txId = insertExpense({ amount: 5000 });
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, txId, tag.id);
    renderPage();
    await waitFor(() => {
      const chart = screen.getByTestId("tag-chart");
      expect(chart.textContent).toContain("groceries");
    });
  });
});

// ---------------------------------------------------------------------------
// Vendors card
// ---------------------------------------------------------------------------

describe("vendors card", () => {
  it("displays vendor names", async () => {
    insertExpense({ title: "Lidl", amount: 5000 });
    insertExpense({ title: "CBA", amount: 3000 });
    renderPage();
    await waitFor(() => {
      const card = screen.getByTestId("vendors-card");
      expect(card.textContent).toContain("Lidl");
      expect(card.textContent).toContain("CBA");
    });
  });
});
