/**
 * SplitTransactionModal.tsx
 *
 * Modal dialog for splitting a transaction into multiple parts,
 * either by fractional proportions or by explicit amounts.
 *
 * Dark-themed to match the rest of the application.
 */

import React, { useState, useMemo } from "react";
import type { SplitSpec } from "../services/SplitTransactionService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRACTION_SUM_TOLERANCE = 0.01;
const MIN_PARTS = 2;

// ---------------------------------------------------------------------------
// Style constants (dark theme)
// ---------------------------------------------------------------------------

const MODAL_STYLE = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  } as React.CSSProperties,

  modal: {
    background: "#1E1E1E",
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "400px",
    width: "90%",
  } as React.CSSProperties,

  heading: {
    color: "#FFFFFF",
    marginTop: 0,
    marginBottom: "16px",
    fontSize: "1.2em",
    textAlign: "center",
  } as React.CSSProperties,

  originalAmount: {
    color: "#B0B0B0",
    textAlign: "center",
    marginBottom: "16px",
    fontSize: "0.95em",
  } as React.CSSProperties,

  modeToggleRow: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    marginBottom: "16px",
  } as React.CSSProperties,

  modeButtonActive: {
    background: "#1565C0",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "16px",
    padding: "6px 16px",
    fontSize: "0.9em",
    cursor: "pointer",
  } as React.CSSProperties,

  modeButtonInactive: {
    background: "#2A2A2A",
    color: "#B0B0B0",
    border: "1px solid #444",
    borderRadius: "16px",
    padding: "6px 16px",
    fontSize: "0.9em",
    cursor: "pointer",
  } as React.CSSProperties,

  partRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  } as React.CSSProperties,

  partLabel: {
    color: "#B0B0B0",
    fontSize: "0.85em",
    minWidth: "50px",
  } as React.CSSProperties,

  partInput: {
    background: "#2A2A2A",
    border: "1px solid #444",
    color: "#E0E0E0",
    borderRadius: "6px",
    padding: "8px",
    width: "80px",
    fontSize: "0.95em",
  } as React.CSSProperties,

  calculatedAmount: {
    color: "#B0B0B0",
    fontSize: "0.85em",
    marginLeft: "4px",
  } as React.CSSProperties,

  removePartBtn: {
    background: "transparent",
    border: "none",
    color: "#FF6B6B",
    cursor: "pointer",
    fontSize: "1.1em",
    padding: "0 4px",
    lineHeight: "1",
  } as React.CSSProperties,

  addPartBtn: {
    background: "#2A2A2A",
    border: "1px solid #444",
    color: "#E0E0E0",
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "0.85em",
    cursor: "pointer",
    marginBottom: "12px",
  } as React.CSSProperties,

  totalRow: {
    marginTop: "12px",
    marginBottom: "12px",
    fontSize: "0.95em",
    textAlign: "center",
  } as React.CSSProperties,

  validOk: { color: "#4CAF50" } as React.CSSProperties,
  validError: { color: "#FF6B6B" } as React.CSSProperties,

  actionRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "16px",
  } as React.CSSProperties,

  cancelBtn: {
    background: "#2A2A2A",
    color: "#E0E0E0",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "1em",
    cursor: "pointer",
  } as React.CSSProperties,

  splitBtn: {
    background: "#FF9800",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "1em",
    cursor: "pointer",
  } as React.CSSProperties,

  errorMessage: {
    color: "#FF6B6B",
    fontSize: "0.85em",
    textAlign: "center",
    marginTop: "8px",
  } as React.CSSProperties,

  remainderRow: {
    color: "#B0B0B0",
    fontSize: "0.85em",
    marginBottom: "8px",
    paddingLeft: "58px",
  } as React.CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Fraction parsing
// ---------------------------------------------------------------------------

/**
 * Parses a fraction string like "1/3" or a decimal like "0.5".
 * Returns null when the input cannot be interpreted as a number.
 */
function parseFractionInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes("/")) {
    const segments = trimmed.split("/");
    if (segments.length !== 2) return null;
    const numerator = parseFloat(segments[0]);
    const denominator = parseFloat(segments[1]);
    if (isNaN(numerator) || isNaN(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }

  const value = parseFloat(trimmed);
  return isNaN(value) ? null : value;
}

/**
 * Formats a number as a display-friendly amount string with up to 2 decimal places.
 */
function formatAmount(value: number): string {
  return Math.round(value * 100) / 100 + "";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SplitTransactionModalProps {
  /** The total amount of the parent transaction. */
  parentAmount: number;
  /** Currency code for display (e.g. "HUF"). */
  currency: string | null;
  /** Called with the built SplitSpec when the user confirms. */
  onSplit: (spec: SplitSpec) => void;
  /** Called when the user cancels. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({
  parentAmount,
  currency,
  onSplit,
  onClose,
}) => {
  const [mode, setMode] = useState<"fraction" | "amount">("amount");
  const [parts, setParts] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);

  const currencyLabel = currency ?? "";

  // -------------------------------------------------------------------------
  // Derived calculations
  // -------------------------------------------------------------------------

  const fractionValues = useMemo(
    () => (mode === "fraction" ? parts.map(parseFractionInput) : []),
    [mode, parts]
  );

  const amountValues = useMemo(
    () =>
      mode === "amount"
        ? parts.map((p) => {
            const v = parseFloat(p.trim());
            return isNaN(v) ? null : v;
          })
        : [],
    [mode, parts]
  );

  const fractionSum = useMemo(
    () => fractionValues.reduce((sum, v) => sum + (v ?? 0), 0),
    [fractionValues]
  );

  const amountSum = useMemo(
    () => amountValues.reduce((sum, v) => sum + (v ?? 0), 0),
    [amountValues]
  );

  const remainder = useMemo(
    () => Math.round((parentAmount - amountSum) * 100) / 100,
    [parentAmount, amountSum]
  );

  const totalDisplay = useMemo(() => {
    if (mode === "fraction") {
      const calculatedTotal = fractionValues.reduce(
        (sum, v) => sum + Math.round((v ?? 0) * parentAmount * 100) / 100,
        0
      );
      return Math.round(calculatedTotal * 100) / 100;
    }
    return Math.round((amountSum + Math.max(0, remainder)) * 100) / 100;
  }, [mode, fractionValues, amountValues, amountSum, remainder, parentAmount]);

  const isTotalValid = useMemo(() => {
    if (mode === "fraction") {
      return Math.abs(fractionSum - 1.0) <= FRACTION_SUM_TOLERANCE;
    }
    return remainder >= 0;
  }, [mode, fractionSum, remainder]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handlePartChange = (index: number, value: string): void => {
    setParts((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setError(null);
  };

  const handleAddPart = (): void => {
    setParts((prev) => [...prev, ""]);
  };

  const handleRemovePart = (index: number): void => {
    setParts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSplit = (): void => {
    setError(null);
    try {
      if (mode === "fraction") {
        const fractions = parts.map((p, i) => {
          const value = parseFractionInput(p);
          if (value === null || value <= 0) {
            throw new Error("Part " + (i + 1) + ": enter a valid fraction > 0");
          }
          return value;
        });
        const sum = fractions.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1.0) > FRACTION_SUM_TOLERANCE) {
          throw new Error(
            "Fractions must sum to 1.0 (currently " + sum.toFixed(4) + ")"
          );
        }
        onSplit({ mode: "fraction", fractions });
      } else {
        const amounts = parts.map((p, i) => {
          const value = parseFloat(p.trim());
          if (isNaN(value) || value <= 0) {
            throw new Error("Part " + (i + 1) + ": enter a valid amount > 0");
          }
          return value;
        });
        const sum = amounts.reduce((a, b) => a + b, 0);
        const rem = Math.round((parentAmount - sum) * 100) / 100;
        if (rem < 0) {
          throw new Error(
            "Sum of parts exceeds original amount (remainder " + rem.toFixed(2) + ")"
          );
        }
        onSplit({ mode: "amount", amounts });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Validation failed";
      setError(message);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={MODAL_STYLE.overlay}
      data-testid="split-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={() => {}}
      role="dialog"
      aria-modal="true"
      aria-label="Split Transaction"
    >
      <div style={MODAL_STYLE.modal}>
        <h2 style={MODAL_STYLE.heading}>Split Transaction</h2>

        {/* Original amount */}
        <p style={MODAL_STYLE.originalAmount} data-testid="split-original">
          Original: {formatAmount(parentAmount)} {currencyLabel}
        </p>

        {/* Mode toggle */}
        <div style={MODAL_STYLE.modeToggleRow}>
          <button
            style={
              mode === "fraction"
                ? MODAL_STYLE.modeButtonActive
                : MODAL_STYLE.modeButtonInactive
            }
            data-testid="split-mode-fraction"
            onClick={() => {
              setMode("fraction");
              setError(null);
            }}
          >
            Fractions
          </button>
          <button
            style={
              mode === "amount"
                ? MODAL_STYLE.modeButtonActive
                : MODAL_STYLE.modeButtonInactive
            }
            data-testid="split-mode-amount"
            onClick={() => {
              setMode("amount");
              setError(null);
            }}
          >
            Amounts
          </button>
        </div>

        {/* Part rows */}
        {parts.map((part, index) => (
          <div style={MODAL_STYLE.partRow} key={index}>
            <span style={MODAL_STYLE.partLabel}>Part {index + 1}:</span>
            <input
              style={MODAL_STYLE.partInput}
              value={part}
              onChange={(e) => handlePartChange(index, e.target.value)}
              data-testid={"split-part-" + index}
              placeholder={mode === "fraction" ? "1/3" : "0"}
              aria-label={"Part " + (index + 1)}
            />
            {mode === "fraction" && fractionValues[index] != null && (
              <span
                style={MODAL_STYLE.calculatedAmount}
                data-testid={"split-part-amount-" + index}
              >
                → {formatAmount(fractionValues[index]! * parentAmount)}{" "}
                {currencyLabel}
              </span>
            )}
            {mode === "amount" && currencyLabel && (
              <span style={MODAL_STYLE.calculatedAmount}>{currencyLabel}</span>
            )}
            {parts.length > MIN_PARTS && (
              <button
                style={MODAL_STYLE.removePartBtn}
                onClick={() => handleRemovePart(index)}
                data-testid={"btn-remove-part-" + index}
                aria-label={"Remove part " + (index + 1)}
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Remainder (amount mode only) */}
        {mode === "amount" && (
          <div style={MODAL_STYLE.remainderRow} data-testid="split-remainder">
            Remainder: {formatAmount(remainder)} {currencyLabel}
          </div>
        )}

        {/* Add Part button */}
        <button
          style={MODAL_STYLE.addPartBtn}
          onClick={handleAddPart}
          data-testid="btn-add-part"
        >
          + Add Part
        </button>

        {/* Total / Validation */}
        <div
          style={{
            ...MODAL_STYLE.totalRow,
            ...(isTotalValid ? MODAL_STYLE.validOk : MODAL_STYLE.validError),
          }}
          data-testid="split-total"
        >
          Total: {formatAmount(totalDisplay)} / {formatAmount(parentAmount)}{" "}
          {currencyLabel} {isTotalValid ? "✓" : "✗"}
        </div>

        {/* Error message */}
        {error && (
          <p style={MODAL_STYLE.errorMessage} data-testid="split-error">
            {error}
          </p>
        )}

        {/* Action buttons */}
        <div style={MODAL_STYLE.actionRow}>
          <button
            style={MODAL_STYLE.cancelBtn}
            onClick={onClose}
            data-testid="btn-split-cancel"
          >
            Cancel
          </button>
          <button
            style={MODAL_STYLE.splitBtn}
            onClick={handleSplit}
            data-testid="btn-split-confirm"
          >
            Split
          </button>
        </div>
      </div>
    </div>
  );
};

export default SplitTransactionModal;
