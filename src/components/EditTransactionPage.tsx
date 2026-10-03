/**
 * EditTransactionPage
 *
 * Full-featured edit view for a single transaction. Renders at '/edit/:id'.
 *
 * Features:
 * - Editable Title (text input) and Description (multi-line textarea).
 * - Cash Transaction toggle and Income toggle.
 * - Current tags list, each with a Remove button.
 * - Word cloud: up to 5 pill buttons for the top-5 most common tags.
 * - Tag search input with 300 ms debounce (activates at 2+ chars) and
 *   suggestions list below.
 * - Add Tag button that creates/links the tag from newTagName.
 * - Save Changes button that persists edits and navigates back to '/'.
 * - Dark-theme styling throughout.
 */

import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Database } from "sql.js";
import type { Tag } from "../models/Tag";
import { useEditTransaction } from "../hooks/useEditTransaction";
import SplitTransactionModal from "./SplitTransactionModal";
import { splitTransaction } from "../services/SplitTransactionService";
import type { SplitSpec } from "../services/SplitTransactionService";
import ToggleSwitch from "./ToggleSwitch";

// ---------------------------------------------------------------------------
// Style constants (dark theme)
// ---------------------------------------------------------------------------

const STYLE = {
  page: {
    background: "#121212",
    color: "#E0E0E0",
    minHeight: "100vh",
    padding: "16px",
    fontFamily: "sans-serif",
  } as React.CSSProperties,

  heading: {
    color: "#FFFFFF",
    marginBottom: "16px",
  } as React.CSSProperties,

  label: {
    display: "block",
    marginBottom: "4px",
    color: "#B0B0B0",
    fontSize: "0.85em",
  } as React.CSSProperties,

  input: {
    width: "100%",
    background: "#1E1E1E",
    color: "#E0E0E0",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "1em",
    boxSizing: "border-box" as const,
    marginBottom: "12px",
  } as React.CSSProperties,

  textarea: {
    width: "100%",
    background: "#1E1E1E",
    color: "#E0E0E0",
    border: "1px solid #444",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "1em",
    boxSizing: "border-box" as const,
    marginBottom: "12px",
    minHeight: "80px",
    resize: "vertical" as const,
  } as React.CSSProperties,

  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    color: "#E0E0E0",
  } as React.CSSProperties,

  sectionTitle: {
    color: "#B0B0B0",
    fontSize: "0.9em",
    marginBottom: "8px",
    marginTop: "16px",
  } as React.CSSProperties,

  tagRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px",
    marginBottom: "12px",
  } as React.CSSProperties,

  tagChip: {
    background: "#2A2A2A",
    border: "1px solid #555",
    borderRadius: "16px",
    padding: "4px 10px",
    color: "#E0E0E0",
    fontSize: "0.85em",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  } as React.CSSProperties,

  removeBtn: {
    background: "transparent",
    border: "none",
    color: "#FF6B6B",
    cursor: "pointer",
    fontSize: "0.9em",
    padding: "0",
    lineHeight: "1",
  } as React.CSSProperties,

  pillBtn: {
    background: "#1565C0",
    border: "none",
    borderRadius: "16px",
    padding: "5px 12px",
    color: "#E0E0E0",
    fontSize: "0.85em",
    cursor: "pointer",
  } as React.CSSProperties,

  suggestionsBox: {
    background: "#1E1E1E",
    border: "1px solid #444",
    borderRadius: "6px",
    marginTop: "-8px",
    marginBottom: "12px",
    overflow: "hidden",
  } as React.CSSProperties,

  suggestionItem: {
    padding: "8px 10px",
    cursor: "pointer",
    color: "#E0E0E0",
    borderBottom: "1px solid #333",
  } as React.CSSProperties,

  actionBtn: {
    background: "#1565C0",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "1em",
    cursor: "pointer",
    marginRight: "8px",
    marginTop: "8px",
  } as React.CSSProperties,

  saveBtn: {
    background: "#2E7D32",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "6px",
    padding: "10px 18px",
    fontSize: "1em",
    cursor: "pointer",
    marginTop: "8px",
  } as React.CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TagChipProps {
  /** The tag to display. */
  tag: Tag;
  /** Called when the user clicks Remove. */
  onRemove: (tagId: number) => void;
}

/** Single tag chip with remove button. */
const TagChip: React.FC<TagChipProps> = ({ tag, onRemove }) => (
  <span
    data-testid={`tag-chip-${tag.id}`}
    style={STYLE.tagChip}
  >
    {tag.name}
    <button
      style={STYLE.removeBtn}
      aria-label={`Remove tag ${tag.name}`}
      data-testid={`remove-tag-${tag.id}`}
      onClick={() => onRemove(tag.id)}
    >
      Remove
    </button>
  </span>
);

// ---------------------------------------------------------------------------
// EditTransactionPageContent  (requires db; always calls the hook)
// ---------------------------------------------------------------------------

interface EditTransactionPageContentProps {
  /** Initialised sql.js Database instance. */
  db: Database;
  /** Transaction id parsed from URL params. */
  transactionId: number;
  onDatabaseChanged?: (db: Database) => void;
}

/**
 * Inner component that owns the hook and all interaction logic.
 * Extracted so the outer wrapper can guard on db availability without
 * violating the Rules of Hooks.
 */
const EditTransactionPageContent: React.FC<
  EditTransactionPageContentProps
> = ({ db, transactionId, onDatabaseChanged }) => {
  const navigate = useNavigate();
  const [showSplitModal, setShowSplitModal] = useState(false);

  // Register OS back-button listener (Android swipe-back / hardware back).
  // Dynamic import guards against jsdom / web environments where the
  // @capacitor/app native plugin is unavailable.
  useEffect(() => {
    let listenerHandle: { remove: () => void } | null = null;

    const registerBackListener = async (): Promise<void> => {
      try {
        const { App } = await import("@capacitor/app");
        listenerHandle = await App.addListener("backButton", () => {
          void navigate("/transactions");
        });
      } catch {
        // Native plugin unavailable (web / jsdom) — silently skip.
      }
    };

    void registerBackListener();

    return () => {
      if (listenerHandle) {
        listenerHandle.remove();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    title,
    description,
    isCash,
    isIncome,
    excludeFromAutoLearn,
    amount,
    currency,
    newTagName,
    currentTags,
    recentTags,
    searchResults,
    setTitle,
    setDescription,
    setIsCash,
    setIsIncome,
    setExcludeFromAutoLearn,
    setAmount,
    setCurrency,
    receivedAt,
    setReceivedAt,
    setNewTagName,
    loadTransaction,
    save,
    addTag,
    removeTag,
    searchTags,
    loadRecentTags,
  } = useEditTransaction(db, onDatabaseChanged);

  // Load transaction and recent tags on mount.
  useEffect(() => {
    loadTransaction(transactionId);
    loadRecentTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setNewTagName(value);
    searchTags(value);
  };

  const handleAddTag = (): void => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    addTag(trimmed);
    setNewTagName("");
  };

  const handleSuggestionClick = (tag: Tag): void => {
    addTag(tag.name);
    setNewTagName("");
    searchTags("");
  };

  const handleSave = (): void => {
    save();
    void navigate("/transactions");
  };

  const handleSplit = (spec: SplitSpec): void => {
    save();
    splitTransaction(db, transactionId, spec);
    if (onDatabaseChanged) onDatabaseChanged(db);
    void navigate("/transactions");
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* Title */}
      <label htmlFor="edit-title" style={STYLE.label}>
        Title
      </label>
      <input
        id="edit-title"
        style={STYLE.input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
        data-testid="input-title"
        placeholder="Transaction title"
      />

      {/* Description */}
      <label htmlFor="edit-description" style={STYLE.label}>
        Description
      </label>
      <textarea
        id="edit-description"
        style={STYLE.textarea}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Description"
        data-testid="input-description"
        placeholder="Transaction description"
      />

      {/* Amount & Currency */}
      <label htmlFor="edit-amount" style={STYLE.label}>
        Amount
      </label>
      <input
        id="edit-amount"
        type="number"
        style={STYLE.input}
        value={amount ?? ""}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          setAmount(isNaN(parsed) ? null : parsed);
        }}
        aria-label="Amount"
        data-testid="input-amount"
        placeholder="0"
        min="0"
        step="any"
      />

      <label htmlFor="edit-currency" style={STYLE.label}>
        Currency
      </label>
      <input
        id="edit-currency"
        style={STYLE.input}
        value={currency ?? ""}
        onChange={(e) => setCurrency(e.target.value.toUpperCase() || null)}
        aria-label="Currency"
        data-testid="input-currency"
        placeholder="HUF"
        maxLength={4}
      />

      {/* Date and Time */}
      <label htmlFor="edit-received-at" style={STYLE.label}>
        Date & Time
      </label>
      <input
        id="edit-received-at"
        type="datetime-local"
        style={STYLE.input}
        value={receivedAt ? receivedAt.slice(0, 16) : ""}
        onChange={(e) => {
          const val = e.target.value;
          setReceivedAt(val ? new Date(val).toISOString() : "");
        }}
        aria-label="Date and time"
        data-testid="input-received-at"
      />

      {/* Cash Transaction toggle */}
      <ToggleSwitch
        checked={isCash}
        onChange={setIsCash}
        label="Cash Transaction"
        ariaLabel="Cash Transaction"
        testId="toggle-cash"
      />

      {/* Income toggle */}
      <div style={{ marginTop: 14 }}>
        <ToggleSwitch
          checked={isIncome}
          onChange={setIsIncome}
          label="Income"
          ariaLabel="Income"
          testId="toggle-income"
        />
      </div>

      {/* Default / Exception tag mode toggle */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 4 }}
        data-testid="tag-mode-toggle"
      >
        <button
          type="button"
          data-testid="tag-mode-default"
          aria-pressed={!excludeFromAutoLearn}
          onClick={() => setExcludeFromAutoLearn(false)}
          style={{
            background: !excludeFromAutoLearn ? "#1565C0" : "#2A2A2A",
            color: !excludeFromAutoLearn ? "#FFFFFF" : "#B0B0B0",
            border: "1px solid " + (!excludeFromAutoLearn ? "#1565C0" : "#555"),
            borderRadius: "6px 0 0 6px",
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: "0.88em",
          }}
        >
          Default
        </button>
        <button
          type="button"
          data-testid="tag-mode-exception"
          aria-pressed={excludeFromAutoLearn}
          onClick={() => setExcludeFromAutoLearn(true)}
          style={{
            background: excludeFromAutoLearn ? "#B71C1C" : "#2A2A2A",
            color: excludeFromAutoLearn ? "#FFFFFF" : "#B0B0B0",
            border: "1px solid " + (excludeFromAutoLearn ? "#B71C1C" : "#555"),
            borderRadius: "0 6px 6px 0",
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: "0.88em",
            marginLeft: -1,
          }}
        >
          Exception
        </button>
      </div>

      {/* Current tags */}
      <p style={STYLE.sectionTitle}>Current Tags</p>
      <div style={STYLE.tagRow} data-testid="current-tags">
        {currentTags.length === 0 && (
          <span style={{ color: "#777", fontSize: "0.85em" }}>No tags</span>
        )}
        {currentTags.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={removeTag} />
        ))}
      </div>

      {/* Word cloud: top-5 common tags */}
      {recentTags.length > 0 && (
        <>
          <p style={STYLE.sectionTitle}>Quick Add</p>
          <div style={STYLE.tagRow} data-testid="word-cloud">
            {recentTags.map((tag) => (
              <button
                key={tag.id}
                style={STYLE.pillBtn}
                aria-label={`Quick add tag ${tag.name}`}
                data-testid={`quick-tag-${tag.id}`}
                onClick={() => addTag(tag.name)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Tag search */}
      <p style={STYLE.sectionTitle}>Search Tags</p>
      <input
        style={STYLE.input}
        value={newTagName}
        onChange={handleSearchChange}
        aria-label="Tag search"
        data-testid="input-tag-search"
        placeholder="Enter tag name..."
      />

      {/* Search suggestions */}
      {searchResults.length > 0 && (
        <div style={STYLE.suggestionsBox} data-testid="tag-suggestions">
          {searchResults.map((tag) => (
            <div
              key={tag.id}
              style={STYLE.suggestionItem}
              role="option"
              aria-label={`Suggestion ${tag.name}`}
              data-testid={`suggestion-${tag.id}`}
              onClick={() => handleSuggestionClick(tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSuggestionClick(tag);
              }}
              tabIndex={0}
            >
              {tag.name}
            </div>
          ))}
        </div>
      )}

      {/* Add Tag button */}
      <button
        style={STYLE.actionBtn}
        onClick={handleAddTag}
        aria-label="Add Tag"
        data-testid="btn-add-tag"
      >
        Add Tag
      </button>

      {/* Split Transaction button */}
      {amount != null && amount > 0 && (
        <button
          style={{
            ...STYLE.actionBtn,
            background: "#7B1FA2",
            marginTop: "8px",
          }}
          onClick={() => setShowSplitModal(true)}
          aria-label="Split Transaction"
          data-testid="btn-split"
        >
          Split Transaction
        </button>
      )}

      {/* Split Transaction Modal */}
      {showSplitModal && amount != null && (
        <SplitTransactionModal
          parentAmount={amount}
          currency={currency}
          onSplit={handleSplit}
          onClose={() => setShowSplitModal(false)}
        />
      )}

      {/* Save Changes button */}
      <button
        style={STYLE.saveBtn}
        onClick={handleSave}
        aria-label="Save Changes"
        data-testid="btn-save"
      >
        Save Changes
      </button>
    </>
  );
};

// ---------------------------------------------------------------------------
// EditTransactionPage  (public export)
// ---------------------------------------------------------------------------

/** Props for the public-facing EditTransactionPage component. */
export interface EditTransactionPageProps {
  /**
   * An initialised sql.js Database instance.
   * When omitted the page renders a loading/error message without
   * attempting database access.
   */
  db?: Database;
  onDatabaseChanged?: (db: Database) => void;
}

/**
 * Edit transaction page component.
 *
 * Reads the transaction `id` from URL params and delegates to
 * {@link EditTransactionPageContent} once a valid db and id are available.
 */
const EditTransactionPage: React.FC<EditTransactionPageProps> = ({
  db,
  onDatabaseChanged,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const numericId = id !== undefined ? parseInt(id, 10) : NaN;

  return (
    <main style={STYLE.page}>
      {/* Back button */}
      <button
        data-testid="edit-back-button"
        aria-label="Back"
        onClick={() => void navigate("/transactions")}
        style={{
          background: "transparent",
          border: "none",
          color: "#90CAF9",
          fontSize: "1em",
          cursor: "pointer",
          padding: "0 0 12px 0",
          display: "block",
        }}
      >
        ← Back
      </button>
      <h1 style={STYLE.heading}>Edit Transaction</h1>

      {db && !isNaN(numericId) ? (
        <EditTransactionPageContent
          db={db}
          transactionId={numericId}
          {...(onDatabaseChanged ? { onDatabaseChanged } : {})}
        />
      ) : (
        <p data-testid="no-db-message">Unable to load transaction.</p>
      )}
    </main>
  );
};

export default EditTransactionPage;
