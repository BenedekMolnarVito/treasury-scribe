/**
 * ToggleSwitch.test.ts
 *
 * Unit tests for the reusable ToggleSwitch component.
 *
 * Environment: jsdom (required for React rendering via @testing-library/react).
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

import ToggleSwitch from "../../src/components/ToggleSwitch.tsx";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ToggleSwitch — rendering", () => {
  it("renders with role='switch'", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
      })
    );
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("renders the label text when label prop is provided", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
        label: "My Toggle",
      })
    );
    expect(screen.getByText("My Toggle")).toBeTruthy();
  });

  it("does not render label text when label prop is omitted", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
      })
    );
    expect(screen.queryByText("My Toggle")).toBeNull();
  });

  it("applies data-testid when testId prop is provided", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
        testId: "my-toggle",
      })
    );
    expect(screen.getByTestId("my-toggle")).toBeTruthy();
  });

  it("uses ariaLabel for aria-label attribute", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
        ariaLabel: "Custom aria label",
      })
    );
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-label")).toBe("Custom aria label");
  });

  it("falls back to label for aria-label when ariaLabel is not provided", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
        label: "Fallback label",
      })
    );
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-label")).toBe("Fallback label");
  });
});

// ---------------------------------------------------------------------------
// aria-checked reflects checked prop
// ---------------------------------------------------------------------------

describe("ToggleSwitch — aria-checked state", () => {
  it("has aria-checked='false' when checked is false", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: vi.fn(),
      })
    );
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("has aria-checked='true' when checked is true", () => {
    render(
      React.createElement(ToggleSwitch, {
        checked: true,
        onChange: vi.fn(),
      })
    );
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Click interaction
// ---------------------------------------------------------------------------

describe("ToggleSwitch — click interaction", () => {
  it("calls onChange with true when clicked while unchecked", () => {
    const handleChange = vi.fn();
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: handleChange,
      })
    );

    fireEvent.click(screen.getByRole("switch"));
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with false when clicked while checked", () => {
    const handleChange = vi.fn();
    render(
      React.createElement(ToggleSwitch, {
        checked: true,
        onChange: handleChange,
      })
    );

    fireEvent.click(screen.getByRole("switch"));
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard interaction
// ---------------------------------------------------------------------------

describe("ToggleSwitch — keyboard interaction", () => {
  it("calls onChange when Enter key is pressed", () => {
    const handleChange = vi.fn();
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: handleChange,
      })
    );

    fireEvent.keyDown(screen.getByRole("switch"), { key: "Enter" });
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange when Space key is pressed", () => {
    const handleChange = vi.fn();
    render(
      React.createElement(ToggleSwitch, {
        checked: true,
        onChange: handleChange,
      })
    );

    fireEvent.keyDown(screen.getByRole("switch"), { key: " " });
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it("does not call onChange for other keys", () => {
    const handleChange = vi.fn();
    render(
      React.createElement(ToggleSwitch, {
        checked: false,
        onChange: handleChange,
      })
    );

    fireEvent.keyDown(screen.getByRole("switch"), { key: "Tab" });
    expect(handleChange).not.toHaveBeenCalled();
  });
});
