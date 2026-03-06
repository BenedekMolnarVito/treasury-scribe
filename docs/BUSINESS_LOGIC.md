# VitoBudgetTracker — Business Logic & User Guide

## What Is VitoBudgetTracker?

VitoBudgetTracker is an Android-only budgeting application built with React, TypeScript, and Capacitor. Its core purpose is simple: **automatically capture every Revolut transaction notification your phone receives, store it locally, and let you organize, review, and export your spending data** — all without ever sending data off your device.

Unlike conventional budgeting apps that require you to link bank accounts or manually log expenses, VitoBudgetTracker sits passively on your phone and reads the push notifications Revolut already sends. Every time you pay for groceries, receive a transfer, or top up your account, the notification is intercepted, parsed, and saved as a searchable transaction.

---

## Why Does This App Exist?

1. **Zero-friction tracking** — You already get Revolut notifications. This app turns them into structured data without any action on your part.
2. **Full data privacy** — All data lives in a local SQLite database on your device. No cloud, no third-party servers, no analytics SDKs.
3. **Flexible categorization** — A lightweight tagging system lets you label transactions (e.g., "food", "rent", "savings") and the app learns your patterns over time through auto-tagging.
4. **Export-first design** — Transactions can be exported to JSON or CSV at any time so you can do further analysis in Excel, Google Sheets, or the included Python CSV transformer.

---

## Complete User Flows

### Flow 1 — First Launch & Permissions Setup

When a new user installs VitoBudgetTracker and opens it for the first time, the following sequence occurs:

1. **App launches** — The React app initializes and immediately checks whether the user has granted **Notification Access** permission via the Capacitor plugin bridge.
2. **Notification Access prompt** — If not granted, the app opens the Android system settings page for Notification Listeners (`Settings → Notifications → Notification access`). The user must find "VitoBudgetTracker" in the list and toggle it on.
3. **POST_NOTIFICATIONS permission** (Android 13+) — A standard runtime permission dialog asks the user to allow the app to display its own foreground-service notification (a small persistent indicator that keeps the listener alive).
4. **Battery optimization exclusion** — The app requests Android to exclude it from battery optimization. This is critical because aggressive battery management (especially on Xiaomi/POCO/Redmi devices with HyperOS or MIUI) would otherwise kill the background listener.
5. **MIUI/HyperOS detection** — If the device is detected as a Xiaomi-family device, the app logs guidance that the user should also enable **Autostart** in system settings (`Settings → Apps → Manage apps → VitoBudgetTracker → Autostart`) and **lock the app in recents** to prevent the OS from aggressively killing it.
6. **Listener connects** — Once notification access is granted and the user returns to the app, the Kotlin Capacitor plugin's `NotificationListenerService` connects. The listener starts as a foreground service with a low-priority persistent notification ("VitoBudget Tracker — Monitoring notifications") to signal to Android that it should be kept alive.
7. **Database initialization** — On the very first launch, the `DatabaseService` initializes sql.js and creates the SQLite database with all required tables (`Transactions`, `Tags`, `TransactionTags`).

**Result**: The app is now silently listening for Revolut notifications in the background. The user sees an empty transaction list with the message "No transactions yet — Revolut notifications will appear here."

---

### Flow 2 — Automatic Notification Capture

This is the core flow that runs continuously in the background:

1. **Revolut sends a push notification** — For example: title = "Lidl", body = "🛒 6 337 Ft összeget fizettél kártyáddal".
2. **Android OS delivers to listener** — The Kotlin Capacitor plugin's `NotificationListenerService.onNotificationPosted()` callback fires.
3. **Package validation** — The `NotificationService.isRevolutNotification()` method checks that the notification came from exactly `com.revolut.revolut`. All other packages are silently ignored.
4. **Data extraction** — The notification's title and body text are extracted from the Android `Notification` extras and forwarded to the TypeScript layer via the Capacitor event bridge.
5. **Amount & currency parsing** — `NotificationService.parseAmountAndCurrency()` uses a regex engine to detect monetary values in multiple formats:
   - `6 337 Ft` → amount: 6337, currency: (detected from "Ft" context or defaults to HUF)
   - `$25.50` → amount: 25.50, currency: USD
   - `1.234,56 EUR` → amount: 1234.56, currency: EUR (European format)
   - `HUF 1 234` → amount: 1234, currency: HUF
6. **Transaction creation** — `NotificationService.createTransactionFromNotification()` builds a `Transaction` object with:
   - `NotificationTitle`, `NotificationBody`, `PackageName`
   - `Amount` and `Currency` (parsed from step 5, defaulting to HUF)
   - `JsonContent` — a JSON blob containing all metadata including the raw text, timestamp, parsed amount/currency
   - `RawContent` — a plain-text representation
   - `ReceivedAt` — UTC timestamp
7. **Background persistence** — The saving logic processes the notification data through the repository layer:
   - **Deduplication check** — `existsDuplicate()` looks for any transaction with the same title, body, package name, and a `ReceivedAt` within a ±5-second window. If found, the notification is skipped.
   - **Save to database** — `addTransaction()` persists the new transaction.
   - **Auto-soft-delete** — `findSoftDeletedMatch()` checks if the user previously soft-deleted a transaction with the exact same title and body. If so, the new transaction is automatically soft-deleted too (the user already decided they don't want to see this type of transaction).
   - **Auto-tagging by vendor** — `findLastTransactionByTitle()` looks for the most recent non-deleted transaction from the same vendor (same `NotificationTitle`). If that transaction has tags (excluding "AddedManually"), those tags are automatically copied to the new transaction.

**Result**: The transaction appears in the list the next time the user opens or refreshes the app.

---

### Flow 3 — Viewing Transactions

1. **User opens the app** — The React component mounts and triggers data loading.
2. **Data loads** — The `useTransactions` hook calls `getAllTransactions()` from the repository, which returns all non-deleted transactions ordered by `receivedAt DESC` (newest first), with `TransactionTags → Tags` joined.
3. **UI renders** — Each transaction appears as a card in a list showing:
   - **Title** (e.g., "Lidl") — bold, top line
   - **Body** (e.g., "🛒 6 337 Ft összeget fizettél kártyáddal") — secondary text
   - **Amount & Currency** (e.g., "6,337.00 HUF") — color-coded: **red** for expenses, **dark green** for income
   - **Timestamp** — formatted date/time
   - **Tags** — displayed as "Tags: food, groceries" in dark green; or "No tags" if untagged
4. **Visual tagging indicator** — Transaction cards use color-coded backgrounds:
   - **Light yellow** (`#FFFACD`) — untagged transactions (0 tags)
   - **Light green** (`#90EE90`) — tagged transactions (1+ tags)

   This makes it immediately obvious which transactions still need the user's attention.

---

### Flow 4 — Editing a Transaction

1. **User taps a transaction card** — Navigation pushes the `EditTransactionPage` component.
2. **Edit form loads** — The `useEditTransaction` hook populates fields:
   - **Title** — editable text entry
   - **Description** — editable multi-line editor
   - **Cash Transaction** toggle — marks whether this was a cash payment
   - **Income** toggle — marks whether this is income vs. expense
   - **Current tags** — listed with individual "Remove" buttons
3. **Quick-add common tags** — A "word cloud" of the 5 most commonly used tags appears as pill-shaped buttons. Tapping one instantly adds it to the transaction.
4. **Tag search** — As the user types in the "Enter tag name..." field:
   - After 2+ characters and a 300ms debounce delay, existing tags matching the query appear as suggestions
   - Tapping a suggestion adds it immediately
   - Or the user can type a new tag name and press "Add Tag" to create and attach it
5. **Remove tags** — Each tag in the list has a "Remove" button that detaches it from the transaction.
6. **Save** — Pressing "Save Changes" calls the hook's update function to sync the state back into the model, then persists to the database via the repository and updates the UI state.
7. **Navigation back** — The user returns to the transactions list, which reloads fresh data.

---

### Flow 5 — Adding a Manual Transaction

Not all spending goes through Revolut. Cash purchases or other bank transfers can be tracked manually:

1. **User taps "Add Transaction"** on the main page.
2. **Sequential prompts** appear:
   - **Title** (required) — e.g., "Coffee"
   - **Description** (required) — e.g., "Cash at local café"
   - **Amount** (optional) — numeric keyboard
   - **Currency** (optional, only if amount was entered)
   - **Is this a cash transaction?** — Yes/No dialog
3. **Transaction is created** — The `useTransactions` hook's `addManualTransaction()`:
   - Creates a `Transaction` with `packageName = "Manual"` and `isCash` as specified
   - Persists to database
   - **Automatically adds the "AddedManually" tag** so manual entries are always distinguishable from captured notifications
4. **List refreshes** — The new transaction appears at the top.

---

### Flow 6 — Deleting Transactions

VitoBudgetTracker uses **soft deletion** to preserve an audit trail and enable the auto-soft-delete feature for recurring unwanted notifications.

#### Single deletion:
1. **Swipe left** on a transaction card → a red "Delete" button appears.
2. **Confirm** the deletion dialog.
3. **Soft-deleted** — `softDeleteTransaction()` sets `isDeleted = true`. The transaction is removed from the visible list but remains in the database.

#### Bulk deletion:
1. **Tap "Clear All"** on the main page.
2. **Confirm** the destructive action dialog.
3. **All visible transactions are soft-deleted** — `softDeleteAllTransactions()` uses a bulk SQL UPDATE for efficiency.

#### Viewing deleted transactions:
1. **Toggle "Show deleted entries"** switch on the main page.
2. When enabled, `getAllTransactionsIncludingDeleted()` returns all transactions regardless of `isDeleted` status.
3. Toggle off to return to the default view (non-deleted only).

---

### Flow 7 — Refreshing & Processing Active Notifications

On Android, the Refresh button does more than just reload the database:

1. **Tap "Refresh"** — The refresh handler triggers.
2. **Reload from DB** — All transactions are fetched fresh from SQLite via sql.js.
3. **(Android only) Process active notifications** — Via the Capacitor plugin bridge, the app accesses currently visible notifications in the Android notification shade.
4. **Each active Revolut notification** is checked against existing transactions (by title, body, package, and time within 1 second). New ones are saved.
5. **User feedback** — A dialog reports how many new transactions were added, or confirms "No new notifications to process."

This is useful if the background listener missed notifications (e.g., after a device restart before the listener reconnected).

---

### Flow 8 — Exporting Transactions

1. **Tap "Export"** — An action sheet asks for the format: **JSON** or **CSV**.
2. **JSON export** — Serializes all non-deleted transactions using `JSON.stringify()` with indented formatting.
3. **CSV export** — Builds a CSV string with headers: `Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName, Amount, Currency, IsCash, Tags, IsDeleted`. Tags are semicolon-separated.
4. **Share** — The exported file is saved and shared via the Capacitor Share plugin — the user can send it to email, Google Drive, WhatsApp, etc.

#### Post-export analysis with the CSV Transformer:
The repository includes a Python utility (`csv_transformer_service/transform_csv.py`) that:
- Reads exported CSV files
- Simplifies them into a 5-column format: `Nap` (date), `Megnevezés` (title), `Tag`, `Kiadás` (amount), `Currency`
- Handles amount extraction from notification body text when the `Amount` field is empty
- Converts dates to `YYYY.MM.DD` format
- Outputs to `csv_transformer_service/outputs/`

---

## Module-by-Module Breakdown

### Models

| Model | Purpose | Why It Matters |
|-------|---------|----------------|
| **Transaction** | Core entity representing a captured or manual financial transaction. Contains notification metadata, parsed amount/currency, and flags for deletion, cash, and income status. | Every feature in the app revolves around this entity. The `parsedAmount` and `parsedCurrency` computed properties provide fallback parsing from `jsonContent` when `amount`/`currency` fields are null (backwards compatibility). |
| **Tag** | A reusable label (e.g., "food", "rent", "savings") with a `lastUsedAt` timestamp. Has a unique name constraint. | Tags are the primary organization mechanism. Without categories, tags give users full flexibility to classify transactions however they want. `lastUsedAt` drives the "most recent" sort order for quick-add suggestions. |
| **TransactionTag** | Join table for the many-to-many relationship between `Transaction` and `Tag`. Tracks `createdAt` for audit purposes. Has a unique composite index on `(transactionId, tagId)`. | Prevents duplicate tag assignments and enables the rich tagging features (add, remove, auto-tag, search). Cascade delete ensures cleanup when a transaction or tag is removed. |

### Data Layer

| Component | Purpose | Why It Matters |
|-----------|---------|----------------|
| **DatabaseService** | Initializes sql.js (SQLite compiled to WebAssembly) and creates the schema with proper keys, indexes, and relationships. | Single source of truth for the database schema. Provides a clean initialization API for both the app and tests. |
| **TransactionRepository** | Full CRUD plus specialized queries: `existsDuplicate`, `findSoftDeletedMatch`, `findLastTransactionByTitle`, `softDeleteAllTransactions`, `getAllTransactionsIncludingDeleted`. | Abstracts all database access behind clean functions. The specialized queries power deduplication, auto-soft-delete, and auto-tagging — the three "smart" behaviors that make the app feel intelligent. |
| **TagRepository** | CRUD for tags, search (`LIKE` query), most-common tags (by usage count), tags ordered by last used, and transaction-tag linking/unlinking. | Powers the entire tagging UX: search-as-you-type, quick-add word cloud, adding/removing tags from transactions, and the idempotent `addTag` (returns existing tag if name matches). |

### Services

| Component | Purpose | Why It Matters |
|-----------|---------|----------------|
| **NotificationService** | Business logic for notification processing: validates package name, extracts title/body, parses amount & currency with a sophisticated regex, creates structured `Transaction` objects with JSON metadata. | The regex handles European (`1.234,56`), US (`1,234.56`), and symbol-prefixed (`$50.00`) formats. Defaults to HUF currency when none is detected. This is the bridge between raw Android notification data and clean domain objects. |

### Hooks (State Management)

| Component | Purpose | Why It Matters |
|-----------|---------|----------------|
| **useTransactions** | Main screen logic: loads/refreshes transactions, soft-deletes, clears all, adds manual transactions, manages tags, exports to JSON/CSV, checks for duplicates. | The central orchestrator. Manages the transaction list state that drives the UI. Every user action on the main screen flows through this hook. |
| **useEditTransaction** | Edit screen logic: holds editable fields (title, body, isCash, isIncome, newTagName), loads transaction data into state, syncs back on save. Manages tags and recent-tags state. | Decouples the edit form from direct model manipulation. Changes only flow back when the user explicitly saves. |

### Components (React UI)

| Component | Purpose | Why It Matters |
|-----------|---------|----------------|
| **TransactionsPage** | Main screen: header buttons (Add, Refresh, Export, Clear All), "Show deleted" toggle, transaction list with swipe-to-delete and tap-to-edit, loading indicator, color-coded cards with tag indicators. | The primary user interface. Uses React state and conditional rendering for display logic. |
| **EditTransactionPage** | Transaction editor: form fields, tag management with search+suggestions+quick-add cloud, save button. Dark theme. | The most interactive screen. Implements debounced search, dynamic tag cloud generation, and careful state management to keep UI in sync with database state. |

### Capacitor Plugin Layer

| Component | Purpose | Why It Matters |
|-----------|---------|----------------|
| **NotificationListenerPlugin** | Kotlin Capacitor plugin that bridges Android's `NotificationListenerService` to the TypeScript layer. Receives notifications from the OS, validates the package, extracts title/body, and forwards them via Capacitor's event system. | The only native code in the app. Kept intentionally thin — all business logic lives in TypeScript for testability. |

### CSV Transformer Service (Python)

| Component | Purpose |
|-----------|---------|
| **transform_csv.py** | Standalone Python script that transforms exported VitoBudgetTracker CSV files into a simplified 5-column format optimized for spreadsheet analysis. Handles amount extraction from notification body text, date reformatting, and batch file processing. |

---

## Smart Behaviors

### Auto-Tagging by Vendor
When a new Revolut notification arrives from a vendor (e.g., "Lidl") that has been tagged before, all tags (except "AddedManually") from the most recent transaction with that title are automatically copied. Over time, this means users only need to tag a vendor **once** — all future transactions inherit the labels.

### Auto-Soft-Delete for Unwanted Notifications
When a user soft-deletes a transaction, the system remembers the title+body combination. If an identical notification arrives in the future, it is automatically soft-deleted. This is useful for recurring notifications the user doesn't want to track (e.g., balance notifications, marketing messages).

### Duplicate Detection
Notifications that arrive within a 5-second window with the same title, body, and package name are treated as duplicates and silently skipped. This prevents the same notification from being recorded twice (which can happen due to Android notification re-posting).

### Manual Transaction Tagging
All manually added transactions are automatically tagged with "AddedManually" to clearly distinguish them from captured notifications in exports and analysis.

---

## Data Privacy & Security

- **All data is stored locally** in the app-private SQLite database (`vitobudget.db`) in the app's sandboxed storage directory.
- **No network transmission** — the app does not send data to any server.
- **No analytics or tracking SDKs** are included.
- **Data is automatically deleted** when the app is uninstalled.
- **Notification access is scoped** — only `com.revolut.revolut` notifications are processed; all others are ignored at the package-name validation step.
- **Export is user-initiated** — data only leaves the device when the user explicitly taps Export and shares the file.
