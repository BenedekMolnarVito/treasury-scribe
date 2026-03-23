/**
 * TransactionsPage
 *
 * Root view that lists all transactions.
 * Rendered at route '/'.
 *
 * Features:
 * - Header buttons: Add Transaction, Refresh, Export, Import, Clear All.
 * - "Show deleted entries" toggle switch.
 * - Transaction cards with bold title, body, amount+currency (red expense /
 *   green income), timestamp, and tags line.
 * - Card backgrounds: #2A2A1A (untagged) / #1A2A1A (tagged).
 * - Swipe-right on a card reveals a red Delete button → confirmation → soft-delete.
 * - Tapping a card navigates to /edit/:id.
 * - Loading spinner while data loads.
 * - Empty-state message when no transactions exist.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";
import { useTransactions } from "../hooks/useTransactions";
import { importTransactions } from "../services/ImportService";
import type { ImportResult } from "../services/ImportService";
import { importRevolutCsv } from "../services/RevolutImportService";
import type { RevolutImportSummary } from "../services/RevolutImportService";
import {
  getActiveTagsWithCounts,
  getTransactionsByTagFilter,
} from "../data/TransactionRepository";
import type { TagWithCount } from "../data/TransactionRepository";
import ToggleSwitch from "./ToggleSwitch";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const BG_UNTAGGED = "#ff99009c";
const BG_TAGGED = "#03356e";
const COLOR_EXPENSE = "#f90e0e";
const COLOR_INCOME = "#4CAF50";
const COLOR_IMPORTED = "#4CAF50";
const COLOR_SKIPPED = "#888";
const COLOR_ERRORS = "#FFB300";

const ACTION_ICON_STYLE: React.CSSProperties = {
  background: "none",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "7px 9px",
  color: "#CCC",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

// ---------------------------------------------------------------------------
// TransactionCard
// ---------------------------------------------------------------------------

interface TransactionCardProps {
  /** The transaction to display. */
  transaction: Transaction;
  /** Called (with the transaction id) when the user confirms deletion. */
  onDelete: (id: number) => Promise<void>;
  /** Called (with the transaction id) when the card is tapped. */
  onClick: (id: number) => void;
}

/**
 * A single transaction list item.
 *
 * Swipe right (>50 px horizontal, <30 px vertical) to reveal the Delete
 * button; swipe left to dismiss it.
 */
const TransactionCard: React.FC<TransactionCardProps> = ({
  transaction,
  onDelete,
  onClick,
}) => {
  const SWIPE_OPEN = 80;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const baseOffset = useRef<number>(0);

  const tagCount = transaction.transactionTags.length;
  const background = tagCount === 0 ? BG_UNTAGGED : BG_TAGGED;
  const amountColor = transaction.isIncome ? COLOR_INCOME : COLOR_EXPENSE;

  const parsedAmount = transaction.parsedAmount;
  const parsedCurrency = transaction.parsedCurrency;
  const amountText =
    parsedAmount !== null
      ? `${parsedAmount} ${parsedCurrency ?? ""}`.trim()
      : "";

  const tagLine =
    tagCount === 0
      ? "No tags"
      : `Tags: ${transaction.transactionTags
          .map((tt) => tt.tagName ?? String(tt.tagId))
          .join(", ")}`;

  // -------------------------------------------------------------------------
  // Touch gesture handlers
  // -------------------------------------------------------------------------

  const handleTouchStart = (e: React.TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    baseOffset.current = swipeOffset;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX.current;
    const dy = Math.abs(touch.clientY - touchStartY.current);
    // Ignore if predominantly vertical (allow page scroll)
    if (dy > Math.abs(dx) && dy > 10) return;
    const next = Math.max(0, Math.min(SWIPE_OPEN, baseOffset.current + dx));
    setSwipeOffset(next);
  };

  const handleTouchEnd = (e: React.TouchEvent): void => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    setIsDragging(false);
    const dx = touch.clientX - touchStartX.current;
    const dy = Math.abs(touch.clientY - touchStartY.current);
    // Compute live offset (covers the case where touchMove events weren't fired, e.g. tests)
    const liveOffset = dy > 80
      ? baseOffset.current
      : Math.max(0, Math.min(SWIPE_OPEN, baseOffset.current + dx));
    // Snap: past midpoint → open; at or before midpoint → closed
    setSwipeOffset(liveOffset > SWIPE_OPEN / 2 ? SWIPE_OPEN : 0);
  };

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const handleDeleteClick = (): void => {
    if (window.confirm("Delete this transaction?")) {
      void onDelete(transaction.id);
    }
  };

  const handleCardClick = (): void => {
    if (swipeOffset > 0) {
      setSwipeOffset(0);
    } else {
      onClick(transaction.id);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      data-testid="transaction-card"
      style={{ position: "relative", overflow: "hidden", marginBottom: 8 }}
    >
      {/* Sliding card face */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Transaction: ${transaction.notificationTitle ?? ""}`}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isDragging ? "none" : "transform 0.15s ease",
          background,
          padding: "12px 16px",
          borderRadius: 8,
          cursor: "pointer",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCardClick();
        }}
      >
        {/* Bold title */}
        <div style={{ fontWeight: "bold" }}>
          {transaction.notificationTitle ?? ""}
        </div>

        {/* Body */}
        <div>{transaction.notificationBody ?? ""}</div>

        {/* Amount + currency */}
        {amountText && (
          <div style={{ color: amountColor, fontWeight: "bold" }}>
            {amountText}
          </div>
        )}

        {/* Timestamp */}
        <div style={{ fontSize: "0.85em" }}>
          {new Date(transaction.receivedAt).toLocaleString('hu-HU', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })}
        </div>

        {/* Tags line */}
        <div style={{ fontSize: "0.85em" }}>{tagLine}</div>
      </div>

      {/* Swipe-right Delete button (revealed progressively during swipe) */}
      {swipeOffset > 0 && (
        <button
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: SWIPE_OPEN,
            background: "red",
            color: "white",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer",
            borderRadius: "8px 0 0 8px",
            opacity: swipeOffset / SWIPE_OPEN,
          }}
          onClick={handleDeleteClick}
          aria-label="Delete transaction"
        >
          Delete
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AddTransactionModal
// ---------------------------------------------------------------------------

interface AddTransactionModalProps {
  /**
   * Called when the user submits the form.
   * Matches the signature of `useTransactions.addManualTransaction`.
   */
  onAdd: (
    title: string,
    description: string,
    amount?: number,
    currency?: string,
    isCash?: boolean,
    isIncome?: boolean,
    receivedAt?: string
  ) => Promise<void>;
  /** Called when the modal should close (Cancel or backdrop click). */
  onClose: () => void;
}

/**
 * Modal dialog for creating a manual transaction.
 */
const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  onAdd,
  onClose,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [isCash, setIsCash] = useState(false);
  const [isIncome, setIsIncome] = useState(false);
  const [receivedAt, setReceivedAt] = useState(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const numericAmount = amount !== "" ? parseFloat(amount) : undefined;
    await onAdd(
      title,
      description,
      numericAmount !== undefined && !isNaN(numericAmount)
        ? numericAmount
        : undefined,
      currency !== "" ? currency : undefined,
      isCash,
      isIncome,
      receivedAt ? new Date(receivedAt).toISOString() : undefined
    );
    onClose();
  };

  const handleBackdropClick = (
    e: React.MouseEvent<HTMLDivElement>
  ): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const inputStyle: React.CSSProperties = {
    background: "#2A2A2A",
    color: "#E0E0E0",
    border: "1px solid #444",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: "0.95em",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add transaction"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <form
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: "20px 20px 28px",
          borderRadius: "16px 16px 0 0",
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          animation: "slideUp 0.25s ease-out",
        }}
        onSubmit={(e) => void handleSubmit(e)}
      >
        {/* Header with close X */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, color: "#FFFFFF", fontSize: "1.1em" }}>Add Transaction</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="btn-close-add-modal"
            style={{ background: "none", border: "none", color: "#888", fontSize: "1.4em", cursor: "pointer", padding: 4, lineHeight: 1 }}
          >✕</button>
        </div>

        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          aria-label="Title"
          style={inputStyle}
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
            style={{ ...inputStyle, flex: 2 }}
          />
          <input
            placeholder="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label="Currency"
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
        <input
          type="datetime-local"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
          aria-label="Date and time"
          data-testid="input-datetime"
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 16 }}>
          <ToggleSwitch
            checked={isCash}
            onChange={setIsCash}
            label="Cash"
            ariaLabel="Cash transaction"
            testId="toggle-add-cash"
          />
          <ToggleSwitch
            checked={isIncome}
            onChange={setIsIncome}
            label="Income"
            ariaLabel="Income"
            testId="toggle-add-income"
          />
        </div>

        <button type="submit" style={{
          background: "#1565C0",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 10,
          padding: "12px 0",
          fontSize: "1em",
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 4,
        }}>Add Transaction</button>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ExportModal
// ---------------------------------------------------------------------------

interface ExportModalProps {
  onSelect: (format: "json" | "csv") => void;
  onClose: () => void;
}

const ExportModal: React.FC<ExportModalProps> = ({ onSelect, onClose }) => {
  const handleBackdropClick = (
    e: React.MouseEvent<HTMLDivElement>
  ): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export transactions"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Export Transactions</h2>
        <button type="button" onClick={() => onSelect("json")} style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>JSON</button>
        <button type="button" onClick={() => onSelect("csv")} style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>CSV</button>
        <button type="button" onClick={onClose} style={{ background: "#333", color: "#E0E0E0", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ImportModal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  db: Database;
  onImported: (result: ImportResult) => void;
  onClose: () => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ db, onImported, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleImport = (): void => {
    if (!selectedFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fileContent = reader.result as string;
        const result = importTransactions(db, fileContent);
        onImported(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        window.alert("Import failed: " + message);
      }
    };
    reader.onerror = () => {
      window.alert("Failed to read file.");
    };
    reader.readAsText(selectedFile);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import transactions"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Import Transactions</h2>
        <p style={{ margin: 0, color: "#B0B0B0" }}>
          Import from a previously exported JSON or CSV file.
        </p>
        <div style={{ background: "#2A2A2A", border: "1px solid #444", borderRadius: "6px", padding: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv,text/comma-separated-values,text/plain"
            onChange={handleFileChange}
            style={{ display: "none" }}
            data-testid="import-file-input"
          />
          <button
            type="button"
            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose File
          </button>
          {selectedFile && (
            <span style={{ marginLeft: 8, color: "#E0E0E0" }}>
              {selectedFile.name}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ background: "#333", color: "#E0E0E0", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
            onClick={handleImport}
            disabled={!selectedFile}
            aria-label="Import"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ImportResultModal
// ---------------------------------------------------------------------------

interface ImportResultModalProps {
  result: ImportResult;
  onClose: () => void;
}

const ImportResultModal: React.FC<ImportResultModalProps> = ({
  result,
  onClose,
}) => {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import complete"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Import Complete ✓</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: COLOR_IMPORTED }}>
            ✅ {result.imported} transactions imported
          </span>
          <span style={{ color: COLOR_SKIPPED }}>
            ⏭️ {result.skipped} duplicates skipped
          </span>
          {result.errors.length > 0 && (
            <span style={{ color: COLOR_ERRORS }}>
              ⚠️ {result.errors.length} errors
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            type="button"
            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RevolutImportModal
// ---------------------------------------------------------------------------

interface RevolutImportModalProps {
  db: Database;
  onImported: (result: RevolutImportSummary) => void;
  onClose: () => void;
}

const RevolutImportModal: React.FC<RevolutImportModalProps> = ({ db, onImported, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  const handleImport = (): void => {
    if (!selectedFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importRevolutCsv(db, reader.result as string);
        onImported(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        window.alert("Revolut import failed: " + message);
      }
    };
    reader.onerror = () => window.alert("Failed to read file.");
    reader.readAsText(selectedFile);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Revolut data"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Revolut Backfill Import</h2>
        <p style={{ margin: 0, color: "#B0B0B0" }}>
          Import a Revolut CSV export to backfill missing transactions.
        </p>
        <div style={{ background: "#2A2A2A", border: "1px solid #444", borderRadius: 6, padding: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/comma-separated-values,text/plain"
            onChange={handleFileChange}
            style={{ display: "none" }}
            data-testid="revolut-file-input"
          />
          <button
            type="button"
            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose CSV File
          </button>
          {selectedFile && (
            <span style={{ marginLeft: 8, color: "#E0E0E0" }}>{selectedFile.name}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ background: "#333", color: "#E0E0E0", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{ background: "#FF9800", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}
            onClick={handleImport}
            disabled={!selectedFile}
            aria-label="Import Revolut"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RevolutImportResultModal
// ---------------------------------------------------------------------------

interface RevolutImportResultModalProps {
  result: RevolutImportSummary;
  onClose: () => void;
}

const RevolutImportResultModal: React.FC<RevolutImportResultModalProps> = ({ result, onClose }) => {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Revolut import complete"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Revolut Import Complete ✓</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: COLOR_IMPORTED }}>
            ✅ {result.imported} transactions imported
          </span>
          <span style={{ color: COLOR_SKIPPED }}>
            ⏭️ {result.skipped} duplicates skipped
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            type="button"
            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TagFilterChips
// ---------------------------------------------------------------------------

interface TagFilterChipsProps {
  tags: TagWithCount[];
  selectedTagIds: Set<number>;
  includeUntagged: boolean;
  onToggleTag: (tagId: number) => void;
  onToggleUntagged: () => void;
  onClearFilter: () => void;
}

const TagFilterChips: React.FC<TagFilterChipsProps> = ({
  tags,
  selectedTagIds,
  includeUntagged,
  onToggleTag,
  onToggleUntagged,
  onClearFilter,
}) => {
  const hasAnyFilter = selectedTagIds.size > 0 || includeUntagged;

  return (
    <div
      aria-label="Tag filter"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginBottom: 12,
        alignItems: "center",
      }}
    >
      {/* Untagged chip */}
      <button
        type="button"
        onClick={onToggleUntagged}
        aria-pressed={includeUntagged}
        style={{
          background: includeUntagged ? "#FF9800" : "#2A2A2A",
          color: includeUntagged ? "#FFFFFF" : "#B0B0B0",
          border: "1px solid " + (includeUntagged ? "#FF9800" : "#444"),
          borderRadius: 16,
          padding: "4px 12px",
          fontSize: "0.85em",
          cursor: "pointer",
        }}
      >
        Untagged
      </button>

      {/* Tag chips */}
      {tags.map((tag) => {
        const selected = selectedTagIds.has(tag.tagId);
        return (
          <button
            key={tag.tagId}
            type="button"
            onClick={() => onToggleTag(tag.tagId)}
            aria-pressed={selected}
            style={{
              background: selected ? "#1565C0" : "#2A2A2A",
              color: selected ? "#FFFFFF" : "#B0B0B0",
              border: "1px solid " + (selected ? "#1565C0" : "#444"),
              borderRadius: 16,
              padding: "4px 12px",
              fontSize: "0.85em",
              cursor: "pointer",
            }}
          >
            {tag.tagName} ({tag.count})
          </button>
        );
      })}

      {/* Clear filter */}
      {hasAnyFilter && (
        <button
          type="button"
          onClick={onClearFilter}
          aria-label="Clear tag filter"
          style={{
            background: "transparent",
            color: "#FF6B6B",
            border: "none",
            fontSize: "0.85em",
            cursor: "pointer",
            padding: "4px 8px",
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TransactionsPageContent  (requires db; always calls the hook)
// ---------------------------------------------------------------------------

interface TransactionsPageContentProps {
  /** Initialised sql.js Database instance. */
  db: Database;
  onDatabaseChanged?: (db: Database) => void;
  dbVersion?: number;
  refreshActiveNotifications?: () => Promise<number>;
}

/**
 * Inner component that owns the hook and all interaction logic.
 * Extracted so that the outer {@link TransactionsPage} wrapper can render it
 * conditionally without violating the Rules of Hooks.
 */
const TransactionsPageContent: React.FC<TransactionsPageContentProps> = ({
  db,
  onDatabaseChanged,
  dbVersion = 0,
  refreshActiveNotifications,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showRevolutImportModal, setShowRevolutImportModal] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [revolutImportResult, setRevolutImportResult] = useState<RevolutImportSummary | null>(null);

  // Tag filter state
  const [availableTags, setAvailableTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const isFilterActive = selectedTagIds.size > 0 || includeUntagged;

  // Respond to ?filter=untagged from dashboard navigation
  useEffect(() => {
    if (searchParams.get("filter") === "untagged") {
      setIncludeUntagged(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const {
    transactions,
    loading,
    showDeleted,
    setShowDeleted,
    loadTransactions,
    softDeleteTransaction,
    softDeleteAllTransactions,
    addManualTransaction,
    exportTransactions,
  } = useTransactions(db, undefined, onDatabaseChanged);

  // Filtered transactions when tag filter is active
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);

  const displayedTransactions = isFilterActive ? filteredTransactions : transactions;

  // Load transactions on mount and whenever showDeleted changes.
  useEffect(() => {
    void loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleted, dbVersion]);

  // Load available tags whenever transactions change
  useEffect(() => {
    setAvailableTags(getActiveTagsWithCounts(db));
  }, [db, dbVersion, transactions]);

  // Apply tag filter when selections change
  useEffect(() => {
    if (!isFilterActive) {
      setFilteredTransactions([]);
      return;
    }
    const filtered = getTransactionsByTagFilter(
      db,
      Array.from(selectedTagIds),
      includeUntagged
    );
    setFilteredTransactions(filtered);
  }, [db, selectedTagIds, includeUntagged, isFilterActive, dbVersion, transactions]);

  // -------------------------------------------------------------------------
  // Header button handlers
  // -------------------------------------------------------------------------



  const handleExport = useCallback((): void => {
    setShowExportModal(true);
  }, []);

  const handleExportSelection = useCallback(
    (format: "json" | "csv"): void => {
      setShowExportModal(false);
      void exportTransactions(format);
    },
    [exportTransactions]
  );

  const handleImported = useCallback(
    (result: ImportResult): void => {
      setShowImportModal(false);
      setImportResult(result);
      if (onDatabaseChanged) onDatabaseChanged(db);
      void loadTransactions();
    },
    [db, loadTransactions, onDatabaseChanged]
  );

  const handleRevolutImported = useCallback(
    (result: RevolutImportSummary): void => {
      setShowRevolutImportModal(false);
      setRevolutImportResult(result);
      if (onDatabaseChanged) onDatabaseChanged(db);
      void loadTransactions();
    },
    [db, loadTransactions, onDatabaseChanged]
  );

  const handleClearAll = useCallback((): void => {
    if (window.confirm("Delete all transactions? This cannot be undone.")) {
      void softDeleteAllTransactions();
    }
  }, [softDeleteAllTransactions]);

  const handleToggleTag = useCallback((tagId: number): void => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  const handleToggleUntagged = useCallback((): void => {
    setIncludeUntagged((prev) => !prev);
  }, []);

  const handleClearFilter = useCallback((): void => {
    setSelectedTagIds(new Set());
    setIncludeUntagged(false);
  }, []);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const PULL_THRESHOLD = 80;

  const [showTagFilter, setShowTagFilter] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handlePullStart = useCallback((e: React.TouchEvent) => {
    const container = scrollContainerRef.current;
    if (container && container.scrollTop <= 0) {
      pullStartY.current = e.touches[0]?.clientY ?? 0;
      isPulling.current = true;
    }
  }, []);

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;
    const y = e.touches[0]?.clientY ?? 0;
    const dist = Math.max(0, Math.min(120, y - pullStartY.current));
    setPullDistance(dist);
  }, [isRefreshing]);

  const handlePullEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(0);
      const addedCount = refreshActiveNotifications ? await refreshActiveNotifications() : 0;
      await loadTransactions();
      setIsRefreshing(false);
      showToast(
        addedCount > 0
          ? `↻ ${addedCount} new notification${addedCount !== 1 ? "s" : ""} captured`
          : "Up to date"
      );
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, refreshActiveNotifications, loadTransactions, showToast]);

  const handleDelete = useCallback(
    async (id: number): Promise<void> => {
      await softDeleteTransaction(id);
    },
    [softDeleteTransaction]
  );

  const handleCardClick = useCallback(
    (id: number): void => {
      void navigate(`/edit/${id}`);
    },
    [navigate]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      ref={scrollContainerRef}
      data-testid="transactions-scroll-container"
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
      style={{ position: "relative" }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div style={{
          textAlign: "center",
          padding: "8px 0",
          height: isRefreshing ? 40 : Math.min(pullDistance, PULL_THRESHOLD) * 0.5,
          overflow: "hidden",
          transition: isRefreshing ? "none" : "height 0.1s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <span style={{
            display: "inline-block",
            fontSize: "1.4em",
            transform: `rotate(${isRefreshing ? 0 : pullDistance * 3}deg)`,
            animation: isRefreshing ? "spin 0.8s linear infinite" : "none",
          }} role="status" aria-label="Pull to refresh">↻</span>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed",
          top: 24,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#333",
          color: "#FFF",
          padding: "8px 20px",
          borderRadius: 20,
          fontSize: "0.85em",
          zIndex: 1100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }} role="status" data-testid="toast">{toast}</div>
      )}

      {/* Compact toolbar: action icon buttons */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
        flexWrap: "wrap",
      }}>
        {/* Filter icon — leftmost position */}
        {availableTags.length > 0 && (
          <button
            onClick={() => setShowTagFilter(prev => !prev)}
            aria-label="Toggle tag filter"
            title="Filter by tags"
            data-testid="btn-toggle-tag-filter"
            style={{
              ...ACTION_ICON_STYLE,
              color: (selectedTagIds.length > 0 || includeUntagged) ? "#1565C0" : "#AAA",
              position: "relative",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            {(selectedTagIds.length > 0 || includeUntagged) && (
              <span style={{
                position: "absolute",
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                background: "#1565C0",
                borderRadius: "50%",
              }} />
            )}
          </button>
        )}
        <button
          onClick={handleExport}
          aria-label="Export"
          title="Export"
          style={ACTION_ICON_STYLE}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </button>
        <button
          onClick={() => setShowImportModal(true)}
          aria-label="Import"
          title="Import"
          style={ACTION_ICON_STYLE}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button
          onClick={() => setShowRevolutImportModal(true)}
          aria-label="Revolut Import"
          title="Revolut Import"
          style={{ ...ACTION_ICON_STYLE, color: "#FF9800" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        </button>
        <button
          onClick={handleClearAll}
          aria-label="Clear All"
          title="Clear All"
          style={{ ...ACTION_ICON_STYLE, color: "#FF6B6B" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>

        <div style={{ flex: 1 }} />

        {/* Show deleted toggle with trash icon label */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: showDeleted ? "#FF6B6B" : "#777", flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <ToggleSwitch
            checked={showDeleted}
            onChange={setShowDeleted}
            label="Deleted"
            ariaLabel="Show deleted entries"
            testId="toggle-show-deleted"
          />
        </div>
      </div>

      {/* Tag cloud filter — animated roll-down */}
      {showTagFilter && availableTags.length > 0 && (
        <div style={{
          overflow: "hidden",
          animation: "slideDown 0.25s ease-out",
          marginBottom: 10,
        }}>
          <TagFilterChips
            tags={availableTags}
            selectedTagIds={selectedTagIds}
            includeUntagged={includeUntagged}
            onToggleTag={handleToggleTag}
            onToggleUntagged={handleToggleUntagged}
            onClearFilter={handleClearFilter}
          />
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div
          role="status"
          aria-label="Loading"
          style={{ textAlign: "center", padding: 32 }}
        >
          <span>Loading…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && displayedTransactions.length === 0 && (
        <p data-testid="empty-state">
          {isFilterActive
            ? "No transactions match the selected filters."
            : "No transactions yet — Revolut notifications will appear here."}
        </p>
      )}

      {/* Transaction list */}
      {!loading && displayedTransactions.length > 0 && (
        <div aria-label="Transaction list">
          {displayedTransactions.map((tx: Transaction) => (
            <TransactionCard
              key={tx.id}
              transaction={tx}
              onDelete={handleDelete}
              onClick={handleCardClick}
            />
          ))}
        </div>
      )}

      {/* Floating "+" Add button */}
      <button
        onClick={() => setShowModal(true)}
        aria-label="Add Transaction"
        data-testid="fab-add"
        style={{
          position: "fixed",
          bottom: 80,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#1565C0",
          color: "#FFF",
          border: "none",
          fontSize: "1.8em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px rgba(21,101,192,0.5)",
          cursor: "pointer",
          zIndex: 800,
          lineHeight: 1,
        }}
      >
        +
      </button>

      {/* Add Transaction modal — slide up from bottom */}
      {showModal && (
        <AddTransactionModal
          onAdd={addManualTransaction}
          onClose={() => setShowModal(false)}
        />
      )}

      {showExportModal && (
        <ExportModal
          onSelect={handleExportSelection}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showImportModal && (
        <ImportModal
          db={db}
          onImported={handleImported}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {importResult && (
        <ImportResultModal
          result={importResult}
          onClose={() => setImportResult(null)}
        />
      )}

      {showRevolutImportModal && (
        <RevolutImportModal
          db={db}
          onImported={handleRevolutImported}
          onClose={() => setShowRevolutImportModal(false)}
        />
      )}

      {revolutImportResult && (
        <RevolutImportResultModal
          result={revolutImportResult}
          onClose={() => setRevolutImportResult(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TransactionsPage  (public export — db is optional)
// ---------------------------------------------------------------------------

/** Props for the public-facing TransactionsPage component. */
export interface TransactionsPageProps {
  /**
   * An initialised sql.js Database instance.
   * When omitted (e.g. in tests that only check routing), the page renders
   * the title and an empty-state message without attempting database access.
   */
  db?: Database;
  onDatabaseChanged?: (db: Database) => void;
  dbVersion?: number;
  refreshActiveNotifications?: () => Promise<number>;
}

/**
 * Root transactions page component.
 *
 * Wraps {@link TransactionsPageContent} so the database-dependent hook can
 * be called unconditionally inside the inner component, satisfying the
 * Rules of Hooks.
 */
const TransactionsPage: React.FC<TransactionsPageProps> = ({
  db,
  onDatabaseChanged,
  dbVersion,
  refreshActiveNotifications,
}) => {
  return (
    <main style={{ padding: 16, paddingBottom: 0, background: "#121212", color: "#E0E0E0", minHeight: "100vh" }}>
      {db ? (
        <TransactionsPageContent
          db={db}
          {...(onDatabaseChanged ? { onDatabaseChanged } : {})}
          {...(dbVersion !== undefined ? { dbVersion } : {})}
          {...(refreshActiveNotifications
            ? { refreshActiveNotifications }
            : {})}
        />
      ) : (
        <p data-testid="empty-state">
          No transactions yet — Revolut notifications will appear here.
        </p>
      )}
    </main>
  );
};

export default TransactionsPage;
