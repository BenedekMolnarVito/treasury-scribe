/**
 * TransactionsPage
 *
 * Root view that lists all transactions.
 * Rendered at route '/'.
 *
 * Features:
 * - Header buttons: Add Transaction, Refresh, Export, Clear All.
 * - "Show deleted entries" toggle switch.
 * - Transaction cards with bold title, body, amount+currency (red expense /
 *   dark-green income), timestamp, and tags line.
 * - Card backgrounds: #FFFACD (untagged) / #90EE90 (tagged).
 * - Swipe-left on a card reveals a red Delete button → confirmation → soft-delete.
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
import { useNavigate } from "react-router-dom";
import type { Database } from "sql.js";
import type { Transaction } from "../models/Transaction";
import { useTransactions } from "../hooks/useTransactions";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const BG_UNTAGGED = "#FFFACD";
const BG_TAGGED = "#90EE90";
const COLOR_EXPENSE = "red";
/** Dark green for income amounts. */
const COLOR_INCOME = "#006400";

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
 * Swipe left (>50 px horizontal, <30 px vertical) to reveal the Delete
 * button; swipe right to dismiss it.
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
    if (dx < -50 && dy < 30) {
      // Swipe left — reveal Delete button.
      setSwiped(true);
    } else if (dx > 20) {
      // Swipe right — hide Delete button.
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
          transform: swiped ? "translateX(-80px)" : "translateX(0)",
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

      {/* Swipe-left Delete button (revealed after swipe) */}
      {swiped && (
        <button
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 80,
            background: "red",
            color: "white",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer",
            borderRadius: "0 8px 8px 0",
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
    isCash?: boolean
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
      isCash
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
          background: "white",
          padding: 24,
          borderRadius: 12,
          minWidth: 300,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h2 style={{ margin: 0 }}>Add Transaction</h2>

        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          aria-label="Title"
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          aria-label="Description"
        />
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
        />
        <input
          placeholder="Currency (e.g. EUR)"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          aria-label="Currency"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={isCash}
            onChange={(e) => setIsCash(e.target.checked)}
          />
          Cash transaction
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Add</button>
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
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 12,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Export Transactions</h2>
        <button type="button" onClick={() => onSelect("json")}>JSON</button>
        <button type="button" onClick={() => onSelect("csv")}>CSV</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
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
  const [showModal, setShowModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

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

  // Load transactions on mount and whenever showDeleted changes.
  useEffect(() => {
    void loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleted, dbVersion]);

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

  const handleClearAll = useCallback((): void => {
    if (window.confirm("Delete all transactions? This cannot be undone.")) {
      void softDeleteAllTransactions();
    }
  }, [softDeleteAllTransactions]);

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
        <button onClick={handleClearAll} aria-label="Clear All">
          Clear All
        </button>
      </div>

      {/* Show deleted toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          type="checkbox"
          role="switch"
          checked={showDeleted}
          onChange={(e) => setShowDeleted(e.target.checked)}
          aria-label="Show deleted entries"
        />
        Show deleted entries
      </label>

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
      {!loading && transactions.length === 0 && (
        <p data-testid="empty-state">
          No transactions yet — Revolut notifications will appear here.
        </p>
      )}

      {/* Transaction list */}
      {!loading && transactions.length > 0 && (
        <div aria-label="Transaction list">
          {transactions.map((tx: Transaction) => (
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
    <main style={{ padding: 16 }}>
      {/* Page title — always rendered so routing tests can find the heading */}
      <h1>Transactions</h1>

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
