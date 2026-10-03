# Treasury Scribe — Architecture

> **Last updated**: October 2026 — reflects the state after the change-requirements implementation (Dashboard tabs & weekly trend, transaction split, app/Revolut CSV import, Default/Exception tagging, OS swipe-back). Branch `feat/2026-10-03-change-reqs-impl`.
>
> Historical note: the project was originally called *VitoBudgetTracker* and migrated from .NET MAUI to React + TypeScript + Capacitor. The npm package name is `workspace`; the product name is **Treasury Scribe**.

## Overview

Treasury Scribe is a **React + TypeScript application deployed to Android via Capacitor** that passively captures Revolut push notifications, stores them with parsed financial metadata in a local SQLite database (sql.js, WebAssembly), and provides a React component-driven UI for viewing, editing, tagging, splitting, importing, and exporting transactions. A standalone Python CSV transformer handles post-export spreadsheet analysis.

### Key Characteristics
- **Android-only** — Capacitor Android app; notification capture uses a thin Kotlin Capacitor plugin bridging Android's `NotificationListenerService`.
- **Offline-first** — all data stays on-device; no network communication.
- **Persistent on-device DB** — the sql.js database is serialised to `localStorage` (base64) under key `treasury-scribe.sqlite` after every mutation and reloaded on launch.
- **Background notification listener** — Android `NotificationListenerService` via the Capacitor bridge, run as a foreground service.
- **All business logic in TypeScript** — the Kotlin plugin only forwards raw notification data, so parsing, ingestion, dedup, auto-tagging, import, and split are all unit-testable without Android tooling.
- **Test-first** — Vitest suite, currently **23 test files / 691 tests**, real in-memory sql.js per test (no data-layer mocks).

---

## High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Android OS                                  │
│   Revolut App ──► Push Notification ──► NotificationListenerService    │
│                          (Kotlin Capacitor Plugin Bridge)              │
└──────────────────────────┬─────────────────────────────────────────── ┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Treasury Scribe App                              │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              CAPACITOR PLUGIN LAYER (Kotlin)                  │      │
│  │  NotificationListenerPlugin — receive, validate, forward      │      │
│  └──────────────────────────┬──────────────────────────────────┘      │
│                             ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              SERVICES LAYER (TypeScript)                      │      │
│  │  NotificationServiceCore  — isRevolutNotification,            │      │
│  │     parseAmountAndCurrency, createTransactionFromNotification │      │
│  │     (NotificationService.ts = thin re-export facade)          │      │
│  │  IngestionService         — dedup → persist → auto-soft-delete│      │
│  │                             → auto-tag (fixed order)          │      │
│  │  ImportService            — app CSV / JSON bulk import         │      │
│  │  RevolutImportService     — Revolut's own CSV import          │      │
│  │  SplitTransactionService  — split one txn into parts          │      │
│  └──────────────────────────┬──────────────────────────────────┘      │
│                             ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              DATA ACCESS LAYER (Repositories)                │      │
│  │  TransactionRepository — CRUD, soft-delete, dedup, vendor &   │      │
│  │     title+body lookup, exception flag, tag-filter queries     │      │
│  │  TagRepository         — CRUD, search, linking, usage stats   │      │
│  │  DashboardRepository   — spending/income by tag/month/week/   │      │
│  │     vendor, summaries, untagged count                         │      │
│  └──────────────────────────┬──────────────────────────────────┘      │
│                             ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              DATABASE LAYER (sql.js / SQLite)                │      │
│  │  DatabaseService — init + schema + localStorage persistence   │      │
│  │  ┌───────────────┐  ┌────────┐  ┌──────────────────┐          │      │
│  │  │  Transactions  │──│  Tags  │──│  TransactionTags │          │      │
│  │  └───────────────┘  └────────┘  └──────────────────┘          │      │
│  └──────────────────────────┬──────────────────────────────────┘      │
│                             ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              PRESENTATION LAYER (React)                      │      │
│  │  Hooks:   useTransactions · useEditTransaction · useDashboard │      │
│  │  Pages:   DashboardPage · TransactionsPage · EditTransaction  │      │
│  │           Page   (src/pages = thin re-exports of components)  │      │
│  │  Shared:  SplitTransactionModal · ToggleSwitch                │      │
│  │  App.tsx: BrowserRouter + fixed bottom navigation bar         │      │
│  └─────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  EXTERNAL TOOLING (Python)                                             │
│  csv_transformer_service/transform_csv.py — post-export CSV → sheet    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Layer Descriptions

### 1. Presentation Layer (React)

#### Routes (`App.tsx`, React Router v6)

| Path | Component | Notes |
|------|-----------|-------|
| `/` | DashboardPage | Default home |
| `/transactions` | TransactionsPage | Transaction list |
| `/edit/:id` | EditTransactionPage | Edit one transaction |
| `/dashboard` | DashboardPage | Alias of `/` |

A fixed **bottom navigation bar** (Dashboard ↔ Transactions, SVG icons, active-state highlighting) sits below all routes. `src/pages/*` are thin re-exports of the corresponding `src/components/*`.

#### React Components

| Component | Responsibility |
|-----------|----------------|
| **DashboardPage** | Analytics home — period pills (This Month, Last Month, 3/6/9/12 Months) in a horizontally scrollable tab strip, spending doughnut by tag, monthly **or** weekly trend line (weekly when a single month is selected), top-vendor list, untagged badge linking to classify. Period changes refresh analytics dynamically. |
| **TransactionsPage** | Main list — colour-coded cards (yellow untagged / green tagged, red expense / green income amount), compact SVG icon toolbar (Refresh, Export, Import, Revolut Import, Clear All), floating **+** add-transaction modal (title/description/amount/currency/date-time/cash/income + tag input + Default/Exception switch), swipe-to-delete with confirm, pull-to-refresh, tag-cloud filter behind a filter icon, show-deleted toggle, tap-to-edit. |
| **EditTransactionPage** | Edit screen — title/description/amount/currency/date-time, cash/income toggles, tag add/remove/search (debounced) + top-tag quick-add cloud, **Default/Exception** switch, save. OS swipe-back enabled (`@capacitor/app` back-button → navigate). Dark theme; remounted per edit to avoid stale state. |
| **SplitTransactionModal** | Split one transaction into fractional or fixed-amount parts. |
| **ToggleSwitch** | Reusable toggle control (Default/Exception, cash, income). |
| **App** | Root — DB bootstrap + persistence, notification listener wiring, routing, bottom nav. |

#### Custom Hooks

| Hook | Responsibility | Result interface |
|------|----------------|------------------|
| **useTransactions** | Main-screen orchestrator: load/refresh, soft-delete (single + bulk), manual add (with tags + exception flag), tag add/remove/search, JSON/CSV export, import, duplicate check, split. Accepts injectable `share?: ShareFn` and `onDatabaseChanged` for testability. | `UseTransactionsResult` |
| **useEditTransaction** | Edit-form state: editable field copies, current/recent tags, Default/Exception state, save logic syncing back to the model. | `UseEditTransactionResult` |
| **useDashboard** | Analytics state: period selection, spending/income summaries, by-tag / by-month / by-week / by-vendor series, untagged count, available tags, selected tag filter. | `UseDashboardResult` |

**Architectural decision — Custom Hooks instead of MVVM**: React hooks replace the .NET MAUI MVVM pattern. Hooks own all screen state and business logic; components are stateless renderers that call a hook and render its typed result. Each hook accepts optional injectable dependencies so it can be tested without native plugins.

### 2. Services Layer (TypeScript Business Logic)

| Service | Key exports |
|---------|-------------|
| **NotificationServiceCore** | `isRevolutNotification(packageName)` — exact match against `com.revolut.revolut`. `parseAmountAndCurrency(text)` → `{ amount, currency }`, six-format regex (see below). `createTransactionFromNotification(title, body, packageName, postedAt?)` — builds a complete `Transaction` with JSON metadata and parsed amount/currency (default HUF). |
| **NotificationService** | Thin re-export facade over `NotificationServiceCore` (re-exports the three functions + `ParsedAmountCurrency`). All logic lives in Core. |
| **IngestionService** | `ingestNotification(db, transaction, dedupWindowSeconds = 5)` — the single entry point for persisting a captured transaction. Runs the fixed four-step smart-behaviour pipeline and returns the persisted `Transaction` (possibly soft-deleted) or `null` if a duplicate was skipped. |
| **ImportService** | `importFromCSV(db, csvContent)`, `importFromJSON(db, jsonContent)`, `importTransactions(db, content)` (auto-detects CSV vs JSON). Returns `ImportResult { imported, skipped, errors }`. Preserves `IsDeleted` so previously-deleted rows re-import as hidden. |
| **RevolutImportService** | `importRevolutCsv(db, csvContent)` → `RevolutImportSummary { imported, skipped }`. Parses Revolut's own CSV export; skips FX conversions (`Átváltás`); ±1-day dedup window. |
| **SplitTransactionService** | `splitTransaction(db, parentId, spec)` → `SplitResult`. `spec` is `SplitByFraction { mode:"fraction"; fractions[] }` (sum ≈ 1.0) or `SplitByAmount { mode:"amount"; amounts[] }` (remainder = final child). Each child inherits parent metadata + non-`AddedManually` tags + a `SplitFrom:{parentId}` tag; the parent is soft-deleted. |

**Currency parsing** — `parseAmountAndCurrency()` matches six formats in priority order: (1) Hungarian payment sentence `1 599 Ft összeget fizettél…`, (2) European `1.234,56 EUR`, (3) space-separated trailing code `6 337 Ft`, (4) code-prefixed `HUF 1 234`, (5) US `$1,234.56` / `1,234.56 USD`, (6) bare number. Default currency = **HUF**. Symbol map: `$→USD`, `€→EUR`, `£→GBP`, `¥→JPY`, `₹→INR`, `₽→RUB`, `₣→CHF`, `₩→KRW`.

**Architectural decision — JSON handling**: native `JSON.parse()` / `JSON.stringify()` handle all JSON; no extra library.

### 3. Data Access Layer (Repositories)

Every repository function takes `db: Database` as its **first parameter** (tests inject an in-memory DB — no singleton import). Queries use prepared statements with `?` binds, select columns explicitly, eager-load `TransactionTags → Tags` via JOIN, and filter `WHERE IsDeleted = 0` by default.

| Repository | Key capabilities |
|------------|------------------|
| **TransactionRepository** | CRUD (`getAllTransactions`, `getAllTransactionsIncludingDeleted`, `getTransactionById`, `addTransaction`, `updateTransaction`, `deleteTransaction` hard-delete for tests). Soft-delete (`softDeleteTransaction`, `softDeleteAllTransactions`). Dedup (`existsDuplicate`, `existsDuplicateWithinSeconds`). `findSoftDeletedMatch` (auto-soft-delete recurring). `findLastTransactionByTitle` and `findLastTransactionByTitleAndBody` (auto-tag by vendor — the latter matches title **and** description with parsed numbers stripped, per FR5). `setTransactionException` (toggle `ExcludeFromAutoLearn`). Tag-filter queries `getActiveTagsWithCounts`, `getTransactionsByTagFilter`. |
| **TagRepository** | `addTag` (idempotent — returns existing on name clash), `searchTags` (LIKE, min 2 chars, by usage, max 10), `getMostCommonTags(limit)`, `getTagsOrderedByLastUsed`, `getTagsForTransaction`, `addTagToTransaction` / `removeTagFromTransaction` (duplicate-safe). Updates `Tag.lastUsedAt` on link. |
| **DashboardRepository** | Analytics with optional `startDate` / `endDate` / `tagIds` filters, base filter `IsDeleted = 0 AND IsIncome = 0 AND Amount IS NOT NULL`: `getSpendingSummary`, `getIncomeSummary`, `getSpendingByTag` (incl. an `Untagged` entry), `getSpendingByMonth` / `getIncomeByMonth` (YYYY-MM), `getSpendingByWeek` / `getIncomeByWeek`, `getSpendingByVendor` (top 10), `getUntaggedTransactionCount`. |

**Architectural decision — Repository pattern over direct SQL**: typed, testable interface; centralised query logic; raw SQL encapsulated behind functions.

### 4. Database Layer

#### DatabaseService (sql.js)

- **Provider**: sql.js (SQLite compiled to WebAssembly). In the Capacitor WebView / browser the WASM is resolved from `sql.js/dist/sql-wasm.wasm?url`; tests pass the binary as an `ArrayBuffer`.
- **Tables**: `Transactions`, `Tags`, `TransactionTags`.
- **Init** (`initDatabase(wasmBinaryOrPath?)`): runs all `CREATE TABLE IF NOT EXISTS` DDL (idempotent) with `PRAGMA foreign_keys = ON`, then an idempotent `ALTER TABLE Transactions ADD COLUMN ExcludeFromAutoLearn …` guarded against the "duplicate column name" error so pre-existing databases migrate forward safely.
- **Persistence**: `loadPersistedDatabase(wasm?, storage?)` reads a base64 snapshot from `localStorage[treasury-scribe.sqlite]` (corrupt snapshot → discard + fresh DB); `persistDatabase(db, storage?)` writes it back; `clearPersistedDatabase(storage?)` removes it. `storage` is injectable (`StorageLike`) for tests; defaults to `window.localStorage`.
- **Schema configuration**: unique index on `Tags.Name`; unique composite index on `TransactionTags (TransactionId, TagId)`; `ON DELETE CASCADE` on both FK relationships.

#### Database Schema

**Transactions Table**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| RawContent | TEXT | NULLABLE | Plain-text notification content |
| JsonContent | TEXT | NULLABLE | Structured JSON with all metadata |
| ReceivedAt | TEXT | NOT NULL | ISO 8601 UTC timestamp |
| NotificationTitle | TEXT | NULLABLE | Notification title (vendor name) |
| NotificationBody | TEXT | NULLABLE | Notification body / description text |
| PackageName | TEXT | NULLABLE | Source app package name |
| IsDeleted | INTEGER | NOT NULL, DEFAULT 0 | Soft-delete flag |
| IsCash | INTEGER | NOT NULL, DEFAULT 0 | Cash transaction flag |
| Amount | REAL | NULLABLE | Parsed monetary amount |
| Currency | TEXT | NULLABLE | Currency code (default: HUF) |
| IsIncome | INTEGER | NOT NULL, DEFAULT 0 | Income vs. expense flag |
| ExcludeFromAutoLearn | INTEGER | NOT NULL, DEFAULT 0 | Exception flag — excludes txn from merchant auto-learning (FR8) |

**Tags Table**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| Name | TEXT | NOT NULL, UNIQUE INDEX | Tag label |
| LastUsedAt | TEXT | NOT NULL | Last time tag was applied |

**TransactionTags Table** (join)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| TransactionId | INTEGER | FK → Transactions, CASCADE | Transaction reference |
| TagId | INTEGER | FK → Tags, CASCADE | Tag reference |
| CreatedAt | TEXT | NOT NULL | When the tag was applied |

**Indexes**: `UNIQUE(TransactionTags.TransactionId, TransactionTags.TagId)`, `UNIQUE(Tags.Name)`.

#### Sample JsonContent

```json
{
  "title": "Lidl",
  "body": "🛒 6 337 Ft összeget fizettél kártyáddal",
  "packageName": "com.revolut.revolut",
  "timestamp": "2026-02-28T14:30:00.0000000Z",
  "rawText": "Lidl: 🛒 6 337 Ft összeget fizettél kártyáddal",
  "amount": 6337,
  "currency": "HUF"
}
```

### 5. Capacitor Plugin Layer (Kotlin)

| Component | Type | Responsibility |
|-----------|------|----------------|
| **NotificationListenerPlugin** | Capacitor plugin (Kotlin) + TS interface (`src/plugins/NotificationListenerPlugin.ts`) | Bridges Android's `NotificationListenerService` to TypeScript. Receives notifications, validates the package, extracts title/body/postedAt, and emits a `notificationReceived` event. Also exposes permission/lifecycle methods consumed by `App.tsx`: `isNotificationAccessGranted`, `openNotificationAccessSettings`, `requestPostNotificationsPermission`, `isBatteryOptimizationExcluded`, `openBatteryOptimizationSettings`, `showAutoStartGuidance`, `startListening`, `getActiveNotifications`. |

**Architectural decision — thin native bridge**: only notification capture requires native code; everything else is TypeScript, so it is testable without Android tooling. **Capacitor over direct native**: Capacitor cleanly bridges the WebView to Android APIs, keeping the bulk of the app in TS. The `@capacitor/app` plugin additionally powers OS swipe-back on the edit screen.

### 6. CSV Transformer Service (Python)

Standalone Python 3.6+ script, no external deps:
- **Input**: app-exported CSVs placed in `csv_transformer_service/`.
- **Output**: simplified 5-column CSVs in `csv_transformer_service/outputs/`.
- **Columns**: `Nap` (`YYYY.MM.DD`), `Megnevezés` (title), `Tag`, `Kiadás` (amount), `Currency`.
- **Amount logic**: uses `Amount` if present, else extracts the first number before "Ft" from `NotificationBody` via regex.
- **Batch**: processes every `.csv` in the folder.

---

## Domain Models

Each model is a TypeScript interface plus a factory function that sets all defaults explicitly. Rows reconstructed from the DB lack the computed getters, so they are passed through `withComputedProps()` to re-attach `parsedAmount` / `parsedCurrency`.

### Transaction

```typescript
interface Transaction {
    // Persisted
    id: number;
    rawContent: string | null;
    jsonContent: string | null;
    receivedAt: string;                 // ISO 8601 UTC
    notificationTitle: string | null;   // vendor name
    notificationBody: string | null;    // body / description text
    packageName: string | null;         // "com.revolut.revolut" or "Manual"
    isDeleted: boolean;                  // default false
    isCash: boolean;                     // default false
    amount: number | null;
    currency: string | null;            // default HUF
    isIncome: boolean;                   // default false
    excludeFromAutoLearn: boolean;       // default false — Exception flag (FR8)

    // Computed getters (fall back to jsonContent)
    parsedAmount: number | null;
    parsedCurrency: string | null;

    // Loaded via JOIN
    transactionTags: TransactionTag[];
}
```
`createTransaction(fields)` builds an object with the getters defined; `withComputedProps(raw)` attaches them to a DB-reconstructed object in place. There is no separate `description` field — the manual-add "description" is stored in `notificationBody`.

### Tag

```typescript
interface Tag {
    id: number;
    name: string;                 // unique index
    lastUsedAt: string;           // updated on link
    transactionTags: TransactionTag[];
}
```

### TransactionTag (join entity)

```typescript
interface TransactionTag {
    id: number;
    transactionId: number;        // FK → Transaction, cascade
    tagId: number;                // FK → Tag, cascade
    tagName?: string;             // denormalised for eager-loaded reads
    createdAt: string;
    // Unique index on (transactionId, tagId)
}
```

---

## Design Patterns & Architectural Decisions

1. **Repository pattern** — raw SQL behind typed functions; `db` is the first arg so tests inject in-memory sql.js (no mocks). Centralises soft-delete filtering, JOINs, ordering.
2. **Custom hooks (not MVVM)** — `useTransactions` / `useEditTransaction` / `useDashboard` own state + logic; components render. Built-in hooks only — no Redux/Zustand (small state surface, three screens).
3. **Service composition** — ingestion/import/split are plain modules composed from repository functions. `NotificationService` is a facade re-exporting `NotificationServiceCore`. No DI container; module imports suffice.
4. **Capacitor plugin bridge** — only the notification listener (and `@capacitor/app` back-button) touches native; all else is testable TS.
5. **Soft deletion** — preserving deleted rows enables auto-soft-delete of recurring unwanted notifications, and lets exports/imports round-trip `IsDeleted` so a re-imported deleted row stays hidden. Hard delete exists only for test cleanup.
6. **Capacitor Android foreground service** — Xiaomi/POCO (MIUI/HyperOS) aggressively kill background processes; the listener runs foreground to stay alive.

---

## Data Flow Diagrams

### Notification Capture (Automatic)

```
Revolut push notification
      │
      ▼
Android OS → NotificationListenerService (Kotlin plugin)
      │  isRevolutNotification(packageName)? ── No ──► ignore
      ▼ Yes
Extract title + body + postedAt → emit "notificationReceived"
      │
      ▼
App.tsx listener → NotificationService.createTransactionFromNotification(title, body, pkg, postedAt)
      │  parseAmountAndCurrency(body) → { amount, currency }
      ▼
IngestionService.ingestNotification(db, transaction, duplicateWindowSeconds = 5)
      │  1. existsDuplicateWithinSeconds(±5 s default)? ── Yes ──► return null (skip)
      │  2. snapshot previous same-vendor txn BEFORE insert (so the new row
      │     doesn't shadow it): findLastTransactionByTitleAndBody (preferred,
      │     body matched with parsed numbers stripped) + findLastTransactionByTitle (fallback)
      │  3. addTransaction()  (persist)
      │  4. findSoftDeletedMatch(title, body)? ── match ──► softDeleteTransaction() (auto-hide)
      │  5. auto-tag by vendor: copy tags (excl. "AddedManually") from the
      │     title+stripped-body match, falling back to the title-only match
      ▼
return persisted Transaction → App persists DB (localStorage)
```

Note: on app focus / visibility change and once at startup, `App.refreshActiveNotifications()` pulls any notifications missed before the listener was ready (`getActiveNotifications`, dedup window 1 s) and ingests them the same way.

### Transaction Display

```
component mounts → useTransactions.loadTransactions()
      ▼
TransactionRepository.getAllTransactions(db)
   WHERE IsDeleted = 0, ORDER BY ReceivedAt DESC, JOIN TransactionTags → Tags
      ▼
React state → re-render cards
   ├─ yellow bg: 0 tags (untagged)      ├─ red amount: expense
   └─ green bg: 1+ tags (tagged)        └─ green amount: income
```

### Manual Transaction Addition

```
tap "+" → slide-up modal (title, description, amount, currency, date-time,
          cash/income toggles, tag input, Default/Exception switch)
      ▼
useTransactions.addManualTransaction()
   ├─ createTransaction (packageName = "Manual", excludeFromAutoLearn per switch)
   ├─ addTransaction(db, …)
   ├─ addTag(db, "AddedManually") + addTagToTransaction(…)
   └─ for each user tag: addTag + addTagToTransaction
      ▼
persist DB → loadTransactions() → UI refresh
```

### Default / Exception Tagging (FR8)

```
Edit or Add view → Default (happy path) selected by default
   Default   → tags feed merchant auto-learning; next txn at this merchant
               auto-inherits them (findLastTransactionByTitleAndBody)
   Exception → setTransactionException(db, id, true): clears auto-assigned
               tags for THIS txn and sets ExcludeFromAutoLearn=1 so it is
               skipped as an auto-tag source — the merchant's default tags
               still apply to future transactions.
```

### Export / Import Flow

```
Export → JSON (JSON.stringify) or CSV (headers + escaped rows, incl. IsDeleted)
      ▼ Capacitor Share sheet → treasury-scribe-transactions_YYYYMMDD_HHMMSS.{json,csv}

Import (app file) → ImportService.importTransactions(db, content)
      ▼ detect CSV/JSON → insert, preserving IsDeleted (deleted rows re-import hidden)
      → ImportResult { imported, skipped, errors }

Revolut Import → RevolutImportService.importRevolutCsv(db, csv)
      ▼ parse Revolut export, skip Átváltás (FX), ±1-day dedup
      → RevolutImportSummary { imported, skipped }

(Optional) python transform_csv.py → simplified CSV in outputs/
```

---

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| UI framework | React | 18 | Component UI |
| Language | TypeScript | 5.x | Primary language |
| Build tool | Vite | 7.x | Dev server + bundler |
| Native bridge | Capacitor | 8.x | Android APIs (`@capacitor/core`, `/android`, `/app`, `/local-notifications`, `/share`) |
| Database | sql.js | 1.14 | SQLite via WebAssembly |
| Routing | React Router | 6.x | Client-side navigation |
| Testing | Vitest | 4.x (+ `@vitest/coverage-v8`) | Test framework |
| Testing utils | Testing Library | 16.x + jsdom | React component testing |
| Scripting | Python | 3.6+ | CSV post-processing |

Commands (`package.json`): `npm run test` (vitest run), `npm run test:watch`, `npm run build` (vite), `npm run dev`, `npm run cap:sync`, `npm run cap:open`, `npm run android:run`. There is no separate lint command — `npx tsc --noEmit` is the type/lint gate.

---

## Project Structure

```
treasury-scribe/
├── package.json · tsconfig.json · vite.config.ts · vitest.config.ts
├── index.html · capacitor.config.ts · README.md · LICENSE · AGENTS.md
├── change_reqs.md                      # active change-request spec
├── .github/copilot-instructions.md     # detailed repo-reality conventions
├── .maestro/                           # behavioral smoke harness
│   ├── smoke.yaml · jev_dom_runner.py
│   └── smoke/  (cdp.py, jev.py, harness.py, scenarios.yaml, out/*.json, report.json)
│
├── docs/
│   ├── ARCHITECTURE.md                 # this document
│   ├── BUSINESS_LOGIC.md               # user flows & smart behaviours
│   ├── templates/                      # doc templates
│   └── updates_2026_10_03/             # design + implementation plans
│
├── src/
│   ├── main.tsx · App.tsx              # entry + root (routing, DB bootstrap, nav)
│   ├── models/     Transaction.ts · Tag.ts · TransactionTag.ts
│   ├── data/       DatabaseService.ts · TransactionRepository.ts ·
│   │               TagRepository.ts · DashboardRepository.ts
│   ├── services/   NotificationService.ts · NotificationServiceCore.ts ·
│   │               IngestionService.ts · ImportService.ts ·
│   │               RevolutImportService.ts · SplitTransactionService.ts
│   ├── hooks/      useTransactions.ts · useEditTransaction.ts · useDashboard.ts
│   ├── components/ DashboardPage.tsx · TransactionsPage.tsx ·
│   │               EditTransactionPage.tsx · SplitTransactionModal.tsx ·
│   │               ToggleSwitch.tsx
│   ├── pages/      DashboardPage · TransactionsPage · EditTransactionPage
│   │               (thin re-exports of components)
│   ├── plugins/    NotificationListenerPlugin.ts
│   ├── __mocks__/  @capacitor/share.ts  (no-op mock for tests)
│   ├── assets/     icon.svg
│   └── types/      assets.d.ts
│
├── android/                            # Capacitor Android project (Kotlin plugin, manifest)
├── csv_transformer_service/            # Python post-export transformer
└── tests/                              # Vitest suite — mirrors src/ (see below)
```

---

## Security & Privacy

| Aspect | Implementation |
|--------|---------------|
| Notification access | Explicit user opt-in via system settings; Capacitor bridge to `NotificationListenerService` |
| Data storage | SQLite via sql.js in app-private `localStorage`; inaccessible to other apps |
| Data transmission | None — no network calls, no analytics |
| Package validation | Only `com.revolut.revolut` notifications processed; all others rejected |
| Data lifecycle | DB auto-deleted on app uninstall; `clearPersistedDatabase()` for in-app clear-all |
| Export/import | User-initiated only; shared via Capacitor Share plugin |

---

## Performance Considerations

| Area | Approach |
|------|----------|
| Database I/O | sql.js runs SQLite synchronously in WASM; bulk ops use single SQL statements |
| Persistence | DB serialised to base64 and written to localStorage only after a mutation, not per read |
| Eager loading | Repository JOINs load `TransactionTags → Tags` in one query (no N+1) |
| UI responsiveness | React virtual DOM + state-driven rendering; heavy work deferred with `useEffect` |
| Debounced search | Edit-screen tag search debounced to avoid per-keystroke queries |

---

## Testing Strategy

- **Framework**: Vitest (+ Testing Library + jsdom for component/hook tests).
- **Database**: real in-memory sql.js per test; a fresh `initDatabase(wasmBinary)` in `beforeEach`, `db.close()` in `afterEach`. No data-layer mocks.
- **Imports**: vitest functions imported explicitly (no globals). `make*` fixture factories build test objects, overriding only what the test cares about.
- **Capacitor**: mocked to no-ops via `src/__mocks__/@capacitor/share.ts`; native APIs never called in tests.
- **Current state**: 23 test files, 691 tests, all passing.

Test files (under `tests/`, mirroring `src/`):

```
App.test.ts · AppLifecycle.test.tsx · AppRefresh.test.tsx · DatabaseService.test.ts
assets/icon.test.ts
components/  DashboardPage · EditTransactionPage · ToggleSwitch · TransactionsPage (.test.ts)
data/        DashboardRepository · DatabaseContext · TagRepository · TransactionRepository
hooks/       useDashboard · useEditTransaction · useTransactions
models/      models.test.ts
plugins/     NotificationListenerPlugin.test.ts
services/    ImportService · IngestionService · NotificationService ·
             RevolutImportService · SplitTransactionService
mock data/   account-statement_*.csv · transactions.json
```

### Behavioral smoke harness (`.maestro/smoke/`)

Beyond unit tests, a deterministic CDP + Jev harness drives the built web app and dumps the DOM per scenario (`out/FR*_*.json` + `report.json`) to verify the change-requirement flows end-to-end (last-month tab, tag show-more, weekly trend, add-tag input, OS back, Default/Exception toggle). See `.maestro/smoke/README.md`.

---

## Android Permissions (Capacitor)

`AndroidManifest.xml` requires:

```xml
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

| Permission | Why |
|-----------|-----|
| `BIND_NOTIFICATION_LISTENER_SERVICE` | Receive notifications via `NotificationListenerService` |
| `FOREGROUND_SERVICE` / `_SPECIAL_USE` | Keep the listener alive as a foreground service |
| `POST_NOTIFICATIONS` | Show the foreground-service notification (Android 13+) |

---

## Onboarding Checklist

### Prerequisites
- Node.js 18+ and npm
- Android Studio (only for Capacitor native work)
- A physical Android device (POCO F5 recommended) — emulators don't reliably support `NotificationListenerService`

### Getting started

```bash
git clone https://github.com/BenedekMolnarVito/treasury-scribe.git
cd treasury-scribe
npm install
npm run test        # all tests, no device needed
npm run dev         # Vite dev server
npm run build       # production build
npx tsc --noEmit    # type check / lint gate
```

### Key files to read first
1. `src/App.tsx` — root, routing, DB bootstrap, notification wiring
2. `src/models/` — domain interfaces + factories
3. `src/data/DatabaseService.ts` — schema, migration, persistence
4. `src/data/TransactionRepository.ts` — transaction data access
5. `src/services/NotificationServiceCore.ts` + `IngestionService.ts` — capture & ingestion
6. `src/hooks/` — screen state + logic
7. `src/components/` — UI
8. `.github/copilot-instructions.md` — authoritative on code conventions & service signatures

### TDD workflow
1. Write a failing Vitest test in `tests/`
2. `npm run test` → red
3. Implement
4. `npm run test` → green, then `npx tsc --noEmit`
5. Refactor green; for UI change-reqs, verify via `.maestro/smoke/`
6. Build and deploy to device for manual verification

### Adding a feature (template)
```
1. src/models/NewEntity.ts            # interface + factory
2. src/data/NewEntityRepository.ts    # repository fns (db first arg)
3. src/services/NewEntityService.ts   # business logic (if needed)
4. src/hooks/useNewEntity.ts          # state + logic
5. src/components/NewEntityPage.tsx   # component (+ src/pages re-export)
6. src/App.tsx                        # route (if new page)
7. tests/.../NewEntity.test.ts        # tests per layer
```

---

## Debugging

```bash
# Development
npm run dev
npm run test:watch
npx tsc --noEmit

# Android (device via Capacitor) — Kotlin package com.treasuryscribe.app
# (no custom log tag is defined; filter by the service/plugin class names)
adb logcat | grep -E "RevolutNotificationService|NotificationListenerPlugin"

# Inject a test notification
adb shell "cmd notification post -t 'Test Revolut' com.revolut.revolut 'You paid 50.00 USD at Store'"

# Check listener status
adb shell settings get secure enabled_notification_listeners
```
