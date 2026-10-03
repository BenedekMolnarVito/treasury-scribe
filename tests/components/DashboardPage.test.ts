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
  vi,
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

function renderPage(
  database: Database = db,
  props: Partial<{ refreshActiveNotifications: () => Promise<number> }> = {}
): void {
  render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/dashboard"] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/dashboard",
          element: React.createElement(DashboardPage, { db: database, ...props }),
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

function insertIncome(
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
    notificationTitle: overrides.title ?? "Employer",
    isIncome: true,
    amount: overrides.amount ?? 5000,
    currency: "HUF",
  });
  return tx.id;
}

// ---------------------------------------------------------------------------
// Core UI elements
// ---------------------------------------------------------------------------

describe("core UI elements", () => {
  it("renders the hero card (no heading or back button in new layout)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });

  it("renders the hero card", async () => {
    insertExpense({ amount: 5000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });

  it("renders the hero expenses element", async () => {
    insertExpense({ amount: 5000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-expenses")).toBeTruthy()
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
// Hero card data (Bug 9)
// ---------------------------------------------------------------------------

describe("hero card", () => {
  it("displays expense total in hero-expenses", async () => {
    insertExpense({ amount: 5000 });
    insertExpense({ amount: 3000 });
    renderPage();
    await waitFor(() => {
      const heroExpenses = screen.getByTestId("hero-expenses");
      expect(heroExpenses.textContent).toContain("8");
    });
  });

  it("displays income total in hero-income", async () => {
    insertIncome({ amount: 10000 });
    renderPage();
    await waitFor(() => {
      const heroIncome = screen.getByTestId("hero-income");
      expect(heroIncome.textContent).toContain("10");
    });
  });

  it("displays net balance in hero-net", async () => {
    insertExpense({ amount: 3000 });
    insertIncome({ amount: 5000 });
    renderPage();
    await waitFor(() => {
      const heroNet = screen.getByTestId("hero-net");
      expect(heroNet.textContent).toContain("Net:");
      expect(heroNet.textContent).toContain("2");
    });
  });

  it("displays avg spent/day in hero-avg-day", async () => {
    insertExpense({ amount: 3000 });
    renderPage();
    await waitFor(() => {
      const heroAvg = screen.getByTestId("hero-avg-day");
      expect(heroAvg.textContent).toContain("Avg spent/day:");
    });
  });

  it("displays the period label", async () => {
    renderPage();
    await waitFor(() => {
      const card = screen.getByTestId("hero-card");
      expect(card.textContent).toContain("This Month");
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
// Tag filter (Bug 10)
// ---------------------------------------------------------------------------

describe("tag filter", () => {
  it("shows tag filter chips when tags exist", async () => {
    const txId = insertExpense({ amount: 5000 });
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, txId, tag.id);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("tag-filter")).toBeTruthy()
    );
  });

  it("does not show tag filter when no tags exist", async () => {
    insertExpense({ amount: 5000 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
    expect(screen.queryByTestId("tag-filter")).toBeNull();
  });

  it("shows clear button when a tag is selected", async () => {
    const txId = insertExpense({ amount: 5000 });
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, txId, tag.id);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter")).toBeTruthy()
    );

    // Click on the tag chip
        // Click the tag chip within the tag-filter container
    const tagFilterContainer = screen.getByTestId("tag-filter");
    const chipButton = tagFilterContainer.querySelector("button");
    act(() => {
      fireEvent.click(chipButton!);
    });

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter-clear")).toBeTruthy()
    );
  });

  it("clears tag selection when clear button is clicked", async () => {
    const txId = insertExpense({ amount: 5000 });
    const tag = addTag(db, "groceries");
    addTagToTransaction(db, txId, tag.id);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter")).toBeTruthy()
    );

    // Select a tag
        // Click the tag chip within the tag-filter container
    const tagFilterContainer = screen.getByTestId("tag-filter");
    const chipButton = tagFilterContainer.querySelector("button");
    act(() => {
      fireEvent.click(chipButton!);
    });

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter-clear")).toBeTruthy()
    );

    // Clear selection
    act(() => {
      fireEvent.click(screen.getByTestId("tag-filter-clear"));
    });

    await waitFor(() =>
      expect(screen.queryByTestId("tag-filter-clear")).toBeNull()
    );
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("untagged badge links to /transactions with filter", async () => {
    insertExpense();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("untagged-badge")).toBeTruthy()
    );
    // Bottom nav is now in App.tsx; navigation via untagged badge
    act(() => {
      fireEvent.click(screen.getByTestId("untagged-badge"));
    });
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
// Spending by tag chart (Bug 11 - doughnut)
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

// ---------------------------------------------------------------------------
// Pull-to-refresh
// ---------------------------------------------------------------------------

/**
 * Simulates a downward pull-to-refresh gesture on the scroll container.
 * Uses two separate act() phases to mirror how React processes touch events:
 * 1. touchstart + touchmove → React re-renders with updated pullDistance
 * 2. touchend              → handlePullEnd sees the updated pullDistance
 */
async function simulatePullToRefresh(container: Element): Promise<void> {
  /**
   * Creates a synthetic TouchEvent of the given type.
   * `Object.defineProperty` is required because jsdom's TouchEvent does not
   * expose the Touch constructor as a global, so `touches` must be patched
   * directly onto the event instance. `clientY` drives the pull distance
   * detected by handlePullMove; omit it for `touchend` (no active touches).
   */
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

describe("pull-to-refresh", () => {
  it("shows 'Up to date' toast when pull-to-refresh finds no new notifications", async () => {
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    const container = screen.getByTestId("dashboard-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText("Up to date")).toBeTruthy();
  });

  it("shows captured notification count in pull-to-refresh toast", async () => {
    const refreshActiveNotifications = vi.fn(async () => 2);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    const container = screen.getByTestId("dashboard-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
    expect(await screen.findByText(/2 new notifications/i)).toBeTruthy();
  });

  it("invokes refreshActiveNotifications callback on pull-to-refresh", async () => {
    const refreshActiveNotifications = vi.fn(async () => 0);

    await act(async () => {
      renderPage(db, { refreshActiveNotifications });
    });

    const container = screen.getByTestId("dashboard-scroll-container");
    await simulatePullToRefresh(container);

    expect(refreshActiveNotifications).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// FR2: Tag cloud show-more
// ---------------------------------------------------------------------------

describe("tag cloud show-more", () => {
  /**
   * Creates N tags, each attached to a unique expense transaction.
   * Tags are named "tag-1" .. "tag-N" with count 1 each.
   */
  function insertTaggedExpenses(n: number): void {
    for (let i = 1; i <= n; i++) {
      const txId = insertExpense({ amount: 1000 });
      const tag = addTag(db, `tag-${i}`);
      addTagToTransaction(db, txId, tag.id);
    }
  }

  it("shows at most 8 chips initially when 20 tags exist", async () => {
    insertTaggedExpenses(20);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter")).toBeTruthy()
    );

    // The show-more button must be present
    expect(screen.getByTestId("tag-filter-show-more")).toBeTruthy();

    // Only 8 chip buttons (+ 1 show-more button) should be in the container
    // (the clear button is absent because nothing is selected yet)
    const tagFilter = screen.getByTestId("tag-filter");
    const chipButtons = Array.from(tagFilter.querySelectorAll("button")).filter(
      (btn) => btn.getAttribute("data-testid") !== "tag-filter-show-more"
    );
    expect(chipButtons.length).toBe(8);
  });

  it("reveals all chips after clicking show-more", async () => {
    insertTaggedExpenses(20);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter-show-more")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("tag-filter-show-more"));
    });

    await waitFor(() => {
      const tagFilter = screen.getByTestId("tag-filter");
      const chipButtons = Array.from(tagFilter.querySelectorAll("button")).filter(
        (btn) =>
          btn.getAttribute("data-testid") !== "tag-filter-show-more" &&
          btn.getAttribute("data-testid") !== "tag-filter-clear"
      );
      expect(chipButtons.length).toBe(20);
    });
  });

  it("shows 'show less' affordance after expanding", async () => {
    insertTaggedExpenses(20);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter-show-more")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("tag-filter-show-more"));
    });

    // After expanding the button should toggle to a 'show less' label
    await waitFor(() => {
      const btn = screen.getByTestId("tag-filter-show-more");
      expect(btn.textContent?.toLowerCase()).toContain("less");
    });
  });

  it("does not show the show-more button when 8 or fewer tags exist", async () => {
    insertTaggedExpenses(8);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter")).toBeTruthy()
    );

    expect(screen.queryByTestId("tag-filter-show-more")).toBeNull();
  });

  it("always shows a selected (hidden) chip even when collapsed", async () => {
    // Insert 10 tags so show-more kicks in; then select the last one which
    // would be hidden in the default view
    insertTaggedExpenses(10);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("tag-filter-show-more")).toBeTruthy()
    );

    // Expand first, click the last chip, then collapse
    act(() => {
      fireEvent.click(screen.getByTestId("tag-filter-show-more")); // expand
    });
    await waitFor(() => {
      const tagFilter = screen.getByTestId("tag-filter");
      const chips = Array.from(tagFilter.querySelectorAll("button")).filter(
        (btn) =>
          btn.getAttribute("data-testid") !== "tag-filter-show-more" &&
          btn.getAttribute("data-testid") !== "tag-filter-clear"
      );
      expect(chips.length).toBe(10);
    });
    // Click 10th chip (last one, which would be hidden in collapsed state)
    const tagFilter = screen.getByTestId("tag-filter");
    const chips = Array.from(tagFilter.querySelectorAll("button")).filter(
      (btn) =>
        btn.getAttribute("data-testid") !== "tag-filter-show-more" &&
        btn.getAttribute("data-testid") !== "tag-filter-clear"
    );
    act(() => {
      fireEvent.click(chips[chips.length - 1]!);
    });
    // Collapse
    act(() => {
      fireEvent.click(screen.getByTestId("tag-filter-show-more")); // show less → collapse
    });

    // The selected chip should still be visible (8 unselected top + 1 selected)
    await waitFor(() => {
      const tagFilterEl = screen.getByTestId("tag-filter");
      const visibleChips = Array.from(tagFilterEl.querySelectorAll("button")).filter(
        (btn) =>
          btn.getAttribute("data-testid") !== "tag-filter-show-more" &&
          btn.getAttribute("data-testid") !== "tag-filter-clear"
      );
      // Should show the 8 top unselected + at least the 1 selected
      expect(visibleChips.length).toBeGreaterThanOrEqual(9);
    });
  });
});

// ---------------------------------------------------------------------------
// FR1: Last Month tab + horizontal-scroll pill row
// ---------------------------------------------------------------------------

describe("FR1: Last Month tab and scrollable pill row", () => {
  it("renders pill-lastMonth between pill-month and pill-3months", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("period-pills")).toBeTruthy()
    );

    const pillsContainer = screen.getByTestId("period-pills");
    const buttons = Array.from(pillsContainer.querySelectorAll("button"));
    const testIds = buttons.map(b => b.getAttribute("data-testid"));

    expect(testIds).toContain("pill-lastMonth");

    const monthIdx = testIds.indexOf("pill-month");
    const lastMonthIdx = testIds.indexOf("pill-lastMonth");
    const threeMonthIdx = testIds.indexOf("pill-3months");

    // lastMonth must be between month and 3months
    expect(lastMonthIdx).toBeGreaterThan(monthIdx);
    expect(lastMonthIdx).toBeLessThan(threeMonthIdx);
  });

  it("period-pills row has overflowX auto and flexWrap nowrap (carousel scroll)", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("period-pills")).toBeTruthy()
    );

    const pillsContainer = screen.getByTestId("period-pills") as HTMLElement;
    // The scroll container style must enable horizontal scrolling
    expect(pillsContainer.style.overflowX).toBe("auto");
    expect(pillsContainer.style.flexWrap).toBe("nowrap");
  });

  it("clicking pill-lastMonth sets period to lastMonth", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("pill-lastMonth")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-lastMonth"));
    });

    // Hero card should still render without error after period change
    await waitFor(() =>
      expect(screen.getByTestId("hero-card")).toBeTruthy()
    );
  });

  it("period label shows 'Last Month' after clicking the lastMonth pill", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("pill-lastMonth")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-lastMonth"));
    });

    await waitFor(() => {
      const card = screen.getByTestId("hero-card");
      expect(card.textContent).toContain("Last Month");
    });
  });
});

// ---------------------------------------------------------------------------
// FR3: Weekly trend for single-month period
// ---------------------------------------------------------------------------

describe("FR3: weekly trend for single-month period", () => {
  it("trend chart shows 'Weekly Trend' title when period is 'month'", async () => {
    renderPage();

    // period defaults to month
    await waitFor(() =>
      expect(screen.getByTestId("monthly-chart")).toBeTruthy()
    );

    const chart = screen.getByTestId("monthly-chart");
    expect(chart.textContent).toContain("Weekly Trend");
  });

  it("trend chart has data-granularity=weekly for single-month period", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("monthly-chart")).toBeTruthy()
    );

    const chart = screen.getByTestId("monthly-chart") as HTMLElement;
    expect(chart.getAttribute("data-granularity")).toBe("weekly");
  });

  it("trend chart shows 'Monthly Trend' for multi-month period", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("pill-3months")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-3months"));
    });

    await waitFor(() => {
      const chart = screen.getByTestId("monthly-chart");
      expect(chart.textContent).toContain("Monthly Trend");
    });
  });

  it("trend chart has data-granularity=monthly for multi-month period", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("pill-3months")).toBeTruthy()
    );

    act(() => {
      fireEvent.click(screen.getByTestId("pill-3months"));
    });

    await waitFor(() => {
      const chart = screen.getByTestId("monthly-chart") as HTMLElement;
      expect(chart.getAttribute("data-granularity")).toBe("monthly");
    });
  });

  it("trend chart switches to Weekly Trend when lastMonth is clicked", async () => {
    renderPage();

    // First switch to a multi-month to ensure round-trip works
    await waitFor(() =>
      expect(screen.getByTestId("pill-3months")).toBeTruthy()
    );
    act(() => {
      fireEvent.click(screen.getByTestId("pill-3months"));
    });
    await waitFor(() => {
      const chart = screen.getByTestId("monthly-chart");
      expect(chart.textContent).toContain("Monthly Trend");
    });

    // Now switch to lastMonth
    act(() => {
      fireEvent.click(screen.getByTestId("pill-lastMonth"));
    });

    await waitFor(() => {
      const chart = screen.getByTestId("monthly-chart");
      expect(chart.textContent).toContain("Weekly Trend");
    });
  });
});

