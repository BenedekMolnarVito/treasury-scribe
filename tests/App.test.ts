/**
 * App.test.ts
 *
 * Tests that the React Router v6 routes render the correct page components.
 *
 * Environment: jsdom (required for React rendering via @testing-library/react).
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, afterEach } from "vitest";

// Static imports for the .tsx page components (Vitest/esbuild transforms them
// via the module graph).
import TransactionsPage from "../src/pages/TransactionsPage.tsx";
import EditTransactionPage from "../src/pages/EditTransactionPage.tsx";

/** Render the app routes with a given initial URL using MemoryRouter. */
function renderAt(initialPath: string): void {
  render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [initialPath] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/",
          element: React.createElement(TransactionsPage),
        }),
        React.createElement(Route, {
          path: "/edit/:id",
          element: React.createElement(EditTransactionPage),
        })
      )
    )
  );
}

describe("App routing", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders TransactionsPage at '/'", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: /transactions/i })).toBeTruthy();
  });

  it("renders EditTransactionPage at '/edit/:id'", () => {
    renderAt("/edit/42");
    expect(
      screen.getByRole("heading", { name: /edit transaction/i })
    ).toBeTruthy();
  });

  it("renders EditTransactionPage without db and shows fallback message", () => {
    renderAt("/edit/99");
    expect(screen.getByTestId("no-db-message")).toBeTruthy();
  });
});
