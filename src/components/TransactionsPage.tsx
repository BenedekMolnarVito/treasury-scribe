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

const BG_UNTAGGED = "#2A2A1A";
const BG_TAGGED = "#1A2A1A";
const COLOR_EXPENSE = "#FF6B6B";
const COLOR_INCOME = "#4CAF50";
const COLOR_IMPORTED = "#4CAF50";
const COLOR_SKIPPED = "#888";
const COLOR_ERRORS = "#FFB300";

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
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

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
    if (touch) {
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent): void => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX.current;
    const dy = Math.abs(touch.clientY - touchStartY.current);
    if (dx > 50 && dy < 30) {
      // Swipe right — reveal Delete button.
      setSwiped(true);
    } else if (dx < -20) {
      // Swipe left — hide Delete button.
      setSwiped(false);
    }
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
    if (!swiped) onClick(transaction.id);
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
          transform: swiped ? "translateX(80px)" : "translateX(0)",
          transition: "transform 0.2s ease",
          background,
          padding: "12px 16px",
          borderRadius: 8,
          cursor: "pointer",
        }}
        onTouchStart={handleTouchStart}
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
        <div style={{ fontSize: "0.85em", color: "#555" }}>
          {transaction.receivedAt}
        </div>

        {/* Tags line */}
        <div style={{ fontSize: "0.85em" }}>{tagLine}</div>
      </div>

      {/* Swipe-right Delete button (revealed after swipe) */}
      {swiped && (
        <button
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 80,
            background: "red",
            color: "white",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer",
            borderRadius: "8px 0 0 8px",
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
    isIncome?: boolean
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
      isIncome
    );
    onClose();
  };

  const handleBackdropClick = (
    e: React.MouseEvent<HTMLDivElement>
  ): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add transaction"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <form
        style={{
          background: "#1E1E1E",
          color: "#E0E0E0",
          padding: 24,
          borderRadius: 12,
          minWidth: 300,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Add Transaction</h2>

        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          aria-label="Title"
          style={{ background: "#2A2A2A", color: "#E0E0E0", border: "1px solid #444", borderRadius: 6, padding: "8px 12px" }}
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          aria-label="Description"
          style={{ background: "#2A2A2A", color: "#E0E0E0", border: "1px solid #444", borderRadius: 6, padding: "8px 12px" }}
        />
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
          style={{ background: "#2A2A2A", color: "#E0E0E0", border: "1px solid #444", borderRadius: 6, padding: "8px 12px" }}
        />
        <input
          placeholder="Currency (e.g. EUR)"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          aria-label="Currency"
          style={{ background: "#2A2A2A", color: "#E0E0E0", border: "1px solid #444", borderRadius: 6, padding: "8px 12px" }}
        />
        <ToggleSwitch
          checked={isCash}
          onChange={setIsCash}
          label="Cash transaction"
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

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ background: "#333", color: "#E0E0E0", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>Add</button>
        </div>
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

  const handleRefresh = useCallback(async (): Promise<void> => {
    const addedCount = refreshActiveNotifications
      ? await refreshActiveNotifications()
      : 0;
    await loadTransactions();
    window.alert(
      addedCount > 0
        ? `${addedCount} new notifications added.`
        : "No new notifications to process."
    );
  }, [loadTransactions, refreshActiveNotifications]);

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

  // -------------------------------------------------------------------------
  // Card handlers
  // -------------------------------------------------------------------------

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
    <>
      {/* Header action buttons */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        <button
          onClick={() => navigate("/dashboard")}
          aria-label="Dashboard"
          style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
        >
          📊 Dashboard
        </button>
        <button
          onClick={() => setShowModal(true)}
          aria-label="Add Transaction"
        >
          Add Transaction
        </button>
        <button onClick={handleRefresh} aria-label="Refresh">
          Refresh
        </button>
        <button onClick={handleExport} aria-label="Export">
          Export
        </button>
        <button
          onClick={() => setShowImportModal(true)}
          aria-label="Import"
          style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
        >
          Import
        </button>
        <button
          onClick={() => setShowRevolutImportModal(true)}
          aria-label="Revolut Import"
          style={{ background: "#FF9800", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}
        >
          Revolut Import
        </button>
        <button onClick={handleClearAll} aria-label="Clear All">
          Clear All
        </button>
      </div>

      {/* Tag filter chips */}
      {availableTags.length > 0 && (
        <TagFilterChips
          tags={availableTags}
          selectedTagIds={selectedTagIds}
          includeUntagged={includeUntagged}
          onToggleTag={handleToggleTag}
          onToggleUntagged={handleToggleUntagged}
          onClearFilter={handleClearFilter}
        />
      )}

      {/* Show deleted toggle */}
      <div style={{ marginBottom: 12 }}>
        <ToggleSwitch
          checked={showDeleted}
          onChange={setShowDeleted}
          label="Show deleted entries"
          ariaLabel="Show deleted entries"
          testId="toggle-show-deleted"
        />
      </div>

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

      {/* Add Transaction modal */}
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
    </>
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
    <main style={{ padding: 16, background: "#121212", color: "#E0E0E0", minHeight: "100vh" }}>
      {/* Page title — always rendered so routing tests can find the heading */}
      <h1 style={{ color: "#FFFFFF" }}>Transactions</h1>

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
