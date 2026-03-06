# Technical Specification

**Architecture:** Module-based React + TypeScript SPA deployed to Android via Capacitor. Five layers: Presentation (React components + hooks) → Services (TypeScript business logic) → Data Access (Repositories) → Database (sql.js / SQLite WASM) → Capacitor Plugin (thin Kotlin bridge). Plus a standalone Python CSV transformer.

**Constraints:**
- Must use React 18, TypeScript 5.x, Vite 7.x, Capacitor 8.x, sql.js 1.14, Vitest 4.x
- Must NOT introduce network calls, analytics SDKs, cloud storage, or DI frameworks
- Must NOT move business logic into the Kotlin native layer — keep the Capacitor plugin as a thin bridge
- Android-only — no iOS support required
- All data persisted in a single on-device SQLite database via sql.js (WebAssembly)

---

## Agent guidance
**Refer to Mission.md for Agent-specific guidance**
- You MUST spawn all seven agents at least one.
- You MUST use *short-term* and *episodic* memory functionalities while iterating through a multi-session implementation flow.
- Optionally, store recurring issues and mission statements into *long-term* memory (vector-embeddings)

## Acceptance Criteria

### AC-1: Project Scaffolding & Configuration
1. `package.json` declares all dependencies listed in the Technology Stack (React 18, TypeScript 5.x, Vite 7.x, Capacitor 8.x, sql.js 1.14, Vitest 4.x, React Router 6.x, Testing Library 16.x).
2. `tsconfig.json` configured for strict mode TypeScript.
3. `vite.config.ts` configured for React + Vitest.
4. `index.html` entry point loads `src/main.tsx`.
5. Project structure matches the canonical layout in ARCHITECTURE.md (`src/models/`, `src/data/`, `src/services/`, `src/hooks/`, `src/components/`, `src/plugins/`, `src/types/`, `tests/`).

### AC-2: Domain Models
1. `src/models/Transaction.ts` exports a `Transaction` interface with all 12 persisted properties (`id`, `rawContent`, `jsonContent`, `receivedAt`, `notificationTitle`, `notificationBody`, `packageName`, `isDeleted`, `isCash`, `amount`, `currency`, `isIncome`), 2 computed properties (`parsedAmount`, `parsedCurrency` falling back to `jsonContent`), and a `transactionTags` navigation array.
2. `src/models/Tag.ts` exports a `Tag` interface with `id`, `name` (unique), `lastUsedAt`, and `transactionTags` navigation array.
3. `src/models/TransactionTag.ts` exports a `TransactionTag` interface with `id`, `transactionId`, `tagId`, `createdAt`.
4. Factory/helper functions create model instances with correct defaults (`isDeleted: false`, `isCash: false`, `isIncome: false`).

### AC-3: Database Layer
1. `src/data/DatabaseService.ts` initializes sql.js and creates the SQLite database with three tables: `Transactions`, `Tags`, `TransactionTags`.
2. Schema matches ARCHITECTURE.md exactly — column names, types, constraints, defaults (`IsDeleted DEFAULT 0`, `IsCash DEFAULT 0`, `IsIncome DEFAULT 0`), foreign keys with `ON DELETE CASCADE`.
3. Unique index on `Tags.Name`.
4. Unique composite index on `TransactionTags(TransactionId, TagId)`.
5. `CREATE TABLE IF NOT EXISTS` used for idempotent initialization.

### AC-4: Transaction Repository
1. `src/data/TransactionRepository.ts` exports functions accepting a `Database` instance (sql.js):
   - `getAllTransactions(db)` — returns non-deleted transactions, ordered by `receivedAt DESC`, with tags eagerly loaded via JOIN.
   - `getAllTransactionsIncludingDeleted(db)` — same but includes soft-deleted.
   - `getTransactionById(db, id)` — single transaction with tags, or null.
   - `addTransaction(db, transaction)` — INSERT.
   - `updateTransaction(db, transaction)` — UPDATE by id.
   - `deleteTransaction(db, id)` — hard DELETE (test-only).
   - `softDeleteTransaction(db, id)` — sets `IsDeleted = 1`.
   - `softDeleteAllTransactions(db)` — bulk UPDATE all to `IsDeleted = 1`.
   - `existsDuplicate(db, title, body, packageName, receivedAt)` — returns `true` if a transaction within ±5 seconds exists with same title, body, and packageName.
   - `findSoftDeletedMatch(db, title, body)` — returns matching soft-deleted transaction or null.
   - `findLastTransactionByTitle(db, title)` — returns most recent non-deleted transaction with given title, with tags loaded.

### AC-5: Tag Repository
1. `src/data/TagRepository.ts` exports functions accepting a `Database` instance:
   - `addTag(db, name)` — idempotent: returns existing tag if name already exists, otherwise creates new.
   - `searchTags(db, query)` — `LIKE` search, minimum 2 chars, ordered by usage count descending, max 10 results.
   - `getMostCommonTags(db, limit)` — top-N tags by transaction count.
   - `getTagsOrderedByLastUsed(db)` — all tags sorted by `lastUsedAt DESC`.
   - `addTagToTransaction(db, transactionId, tagId)` — creates link, prevents duplicates via unique index, updates `Tag.lastUsedAt`.
   - `removeTagFromTransaction(db, transactionId, tagId)` — removes link.

### AC-6: Notification Service
1. `src/services/NotificationService.ts` exports:
   - `isRevolutNotification(packageName)` — returns `true` only for exact match `"com.revolut.revolut"`.
   - `parseAmountAndCurrency(text)` — regex engine handles formats: European (`1.234,56 EUR`), US (`$1,234.56`), space-separated (`6 337 Ft`), symbol-prefixed (`$50.00`), plain (`HUF 1 234`). Returns `{ amount: number | null, currency: string | null }`.
   - `createTransactionFromNotification(title, body, packageName)` — returns a complete `Transaction` with: `notificationTitle`, `notificationBody`, `packageName`, `amount`/`currency` from parsing (defaulting to HUF), `jsonContent` containing `{ title, body, packageName, timestamp, rawText, amount, currency }`, `rawContent` as plain text, `receivedAt` as UTC ISO 8601.

### AC-7: useTransactions Hook
1. `src/hooks/useTransactions.ts` provides state and actions for the main screen:
   - State: `transactions` array, `loading` boolean, `showDeleted` boolean.
   - `loadTransactions()` — fetches via repository; toggles between deleted/non-deleted based on `showDeleted`.
   - `softDeleteTransaction(id)` — soft-deletes one transaction, refreshes list.
   - `softDeleteAllTransactions()` — bulk soft-delete, refreshes list.
   - `addManualTransaction(title, description, amount?, currency?, isCash?)` — creates transaction with `packageName = "Manual"`, persists, auto-tags with `"AddedManually"`, refreshes.
   - `exportTransactions(format: "json" | "csv")` — serializes non-deleted transactions; CSV headers: `Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName, Amount, Currency, IsCash, Tags, IsDeleted`; tags semicolon-separated.
   - Tag management: `addTagToTransaction`, `removeTagFromTransaction`, `searchTags`.
   - `checkDuplicate(title, body, packageName, receivedAt)` — wraps repository dedup check.

### AC-8: useEditTransaction Hook
1. `src/hooks/useEditTransaction.ts` provides state and actions for the edit screen:
   - State: editable copies of `title`, `description` (body), `isCash`, `isIncome`, `newTagName`, current tags, recent tags.
   - `loadTransaction(id)` — populates state from repository.
   - `save()` — syncs edited fields back to model, persists via repository.
   - `addTag(name)` — creates/finds tag, links to transaction.
   - `removeTag(tagId)` — unlinks tag from transaction.
   - `searchTags(query)` — debounced (300ms), minimum 2 chars, returns matching tags.
   - `loadRecentTags()` — top-5 most common tags for quick-add word cloud.

### AC-9: TransactionsPage Component
1. `src/components/TransactionsPage.tsx` renders:
   - Header buttons: "Add Transaction", "Refresh", "Export", "Clear All".
   - "Show deleted entries" toggle switch.
   - Transaction list — each card shows: title (bold), body, amount + currency (red for expense, dark green for income), timestamp, tags line (`"Tags: x, y"` or `"No tags"`).
   - Card backgrounds: light yellow (`#FFFACD`) for untagged (0 tags), light green (`#90EE90`) for tagged (1+ tags).
   - Swipe-left reveals red "Delete" button → confirmation dialog → soft-delete.
   - Tap card → navigates to `EditTransactionPage`.
   - Loading spinner while data loads.
   - Empty state: "No transactions yet — Revolut notifications will appear here."

### AC-10: EditTransactionPage Component
1. `src/components/EditTransactionPage.tsx` renders:
   - Form fields: Title (text), Description (multi-line), Cash Transaction (toggle), Income (toggle).
   - Current tags with individual "Remove" buttons.
   - Quick-add word cloud: 5 pill-shaped buttons for top-5 most common tags. Tap to add.
   - Tag search input ("Enter tag name...") with debounced suggestions (300ms, 2+ chars).
   - "Add Tag" button for new tag creation.
   - "Save Changes" button → persists and navigates back.
   - Dark theme styling.

### AC-11: Capacitor Notification Listener Plugin
1. `src/plugins/NotificationListenerPlugin.ts` defines the TypeScript interface for the Kotlin Capacitor plugin bridge.
2. Kotlin plugin (`NotificationListenerPlugin`):
   - Extends Android `NotificationListenerService`.
   - Runs as a foreground service with a low-priority persistent notification ("VitoBudget Tracker — Monitoring notifications").
   - `onNotificationPosted()` — validates package is `com.revolut.revolut`, extracts title + body from notification extras, fires Capacitor event to TypeScript layer.
   - All other packages silently ignored.
3. App setup handles permissions: Notification Access, POST_NOTIFICATIONS (Android 13+), battery optimization exclusion, MIUI/HyperOS autostart guidance.

### AC-12: Smart Behaviors
1. **Deduplication** — Before saving, `existsDuplicate()` checks for same title + body + packageName within ±5-second window. Duplicate → skip silently.
2. **Auto-soft-delete** — After saving, `findSoftDeletedMatch()` checks for previously soft-deleted transaction with same title + body. Match → auto-soft-delete the new transaction.
3. **Auto-tagging by vendor** — After saving, `findLastTransactionByTitle()` finds most recent non-deleted transaction with same title. If it has tags (excluding `"AddedManually"`), copy them to the new transaction.
4. **Manual transaction auto-tag** — All manually added transactions receive the `"AddedManually"` tag automatically.

### AC-13: Export & CSV Transformer
1. JSON export: `JSON.stringify` with indentation, all non-deleted transactions.
2. CSV export: headers `Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName, Amount, Currency, IsCash, Tags, IsDeleted`; tags semicolon-separated; proper escaping.
3. Share via Capacitor Share plugin.
4. `csv_transformer_service/transform_csv.py` (Python 3.6+, no external deps):
   - Input: CSV files in `csv_transformer_service/`.
   - Output: 5-column CSV (`Nap`, `Megnevezés`, `Tag`, `Kiadás`, `Currency`) in `csv_transformer_service/outputs/`.
   - Amount logic: use `Amount` column if present; else regex-extract first number followed by "Ft" from `NotificationBody`.
   - Date format: `YYYY.MM.DD`.
   - Batch: processes all `.csv` files in folder.

### AC-14: Routing & App Shell
1. `src/App.tsx` sets up React Router with routes for `TransactionsPage` (default `/`) and `EditTransactionPage` (`/edit/:id`).
2. `src/main.tsx` renders the `App` component into the DOM.

### AC-15: Testing
1. All tests use Vitest with real in-memory sql.js databases (no mocks for data layer).
2. Each test creates a fresh database instance in `beforeEach`, closes in `afterEach`.
3. Required test files and coverage:
   - `tests/models/models.test.ts` — model defaults, `parsedAmount`/`parsedCurrency` fallback logic, Tag defaults, TransactionTag properties.
   - `tests/data/DatabaseContext.test.ts` — database creation, table existence, schema correctness.
   - `tests/data/TransactionRepository.test.ts` — full CRUD, soft-delete, bulk delete, deduplication (±5s window), soft-deleted match, vendor lookup, JOIN ordering.
   - `tests/data/TagRepository.test.ts` — tag CRUD, search, most-common, ordered-by-last-used, transaction linking/unlinking, idempotent add.
   - `tests/services/NotificationService.test.ts` — package validation, amount/currency parsing (European, US, space-separated, symbol-prefixed formats), transaction creation, JSON structure.
4. Tests must pass before any feature is considered complete (TDD workflow).

### AC-16: MOST IMPORTANT: Behavioral testing
1. Must read scenarios in .\.qa folder and try EACH of them out.
2. Must run scenarios in Android Studio emulated environment.
3. If a missing application or dependency causes blockage in testing, call *researcher* agent to do web search on how to download the dependency and install it. A missing program should never be asked from user.
4. **Definition of Done**: you MUST verify that ALL test scenarios in *scenarios.md* is giving the expected result.

---

## Implementation Order (Recommended)

1. **AC-1** — Project scaffolding & configuration
2. **AC-2** — Domain models
3. **AC-3** — Database layer (DatabaseService)
4. **AC-4** — Transaction repository + tests
5. **AC-5** — Tag repository + tests
6. **AC-6** — Notification service + tests
7. **AC-7** — useTransactions hook
8. **AC-8** — useEditTransaction hook
9. **AC-14** — Routing & App shell
10. **AC-9** — TransactionsPage component
11. **AC-10** — EditTransactionPage component
12. **AC-11** — Capacitor notification listener plugin
13. **AC-12** — Smart behaviors (dedup, auto-soft-delete, auto-tag)
14. **AC-13** — Export & CSV transformer
15. **AC-15** — Full test suite validation
16. **AC-16** — Full behavioral test validation
