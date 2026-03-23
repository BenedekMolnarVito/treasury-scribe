# Copilot Instructions — Treasury Scribe

## What This App Is

An **Android-only, offline-first budgeting app** that passively captures Revolut push notifications via a thin Kotlin Capacitor plugin, parses financial data (amount, currency, vendor) from notification text, stores everything locally in SQLite (sql.js WebAssembly), and provides a React UI for tagging, editing, and exporting transactions. Zero network calls — all data stays on-device.

## Commands

**CRITICAL: If terminal a command does not run: append `; echo ""` to PowerShell commands when using `run_in_terminal`**

```bash
npm test               # Run all tests once
npm run test:watch     # Watch mode (TDD)

# Single test file:
npx vitest run tests/data/TransactionRepository.test.ts

# Tests matching a name pattern:
npx vitest run --grep "getAllTransactions"

# Build / run
npm run build          # Vite production build
npm run dev            # Vite dev server
npm run cap:sync       # Sync web assets to Android
npm run cap:open       # Open Android Studio
npm run android:run    # build → cap sync → gradle installDebug
```

There is no separate lint command. TypeScript strict-mode checking happens at compile time via `tsc`.

## Architecture

Five layers, each with a strict responsibility:

```
Capacitor Plugin (Kotlin)      — Listens for Revolut notifications, forwards to TS via event
  ↓
NotificationServiceCore (TS)   — Validates package ID, parses amount/currency via regex, builds Transaction
  ↓
IngestionService (TS)          — Orchestrates 4 smart behaviors: dedup → persist → auto-soft-delete → auto-tag
  ↓
Repositories (TS)              — All SQLite access via prepared statements with eager-loaded JOINs
  ↓
React (hooks + components)     — useTransactions / useEditTransaction / useDashboard hooks own all screen state
```

`NotificationService.ts` is a thin re-export facade over `NotificationServiceCore.ts` — all logic lives in the Core file.

**All business logic lives in TypeScript** — the Kotlin plugin is intentionally thin so everything is testable.

Key documentation:
- `docs/ARCHITECTURE.md` — detailed layer breakdown, schema, module responsibilities
- `docs/BUSINESS_LOGIC.md` — 8 complete user flows and smart behaviour descriptions

### App bootstrap sequence (App.tsx)
1. Load persisted SQLite DB from `localStorage` via `loadPersistedDatabase()`.
2. Register Capacitor notification listener; each incoming notification runs `ingestNotification()`.
3. On app focus, call `NotificationListener.getActiveNotifications()` to pull any missed notifications from the Android notification shade (dedup window: 1 s).
4. Prompt for notification access → POST_NOTIFICATIONS permission → battery optimization exclusion → MIUI/HyperOS auto-start guidance (each only once per session).

### Routes
- `/` → `DashboardPage` (default home)
- `/transactions` → `TransactionsPage`
- `/edit/:id` → `EditTransactionPage`
- `/dashboard` → `DashboardPage` (alias)

## Key Conventions

### Repository pattern
All database functions live in `src/data/` and take `db: Database` as their **first parameter** — this is how tests inject an in-memory DB. Never import a singleton DB instance.

```typescript
// Correct
export function getAllTransactions(db: Database): Transaction[] { ... }

// Wrong — untestable
export function getAllTransactions(): Transaction[] { /* imports db from module */ }
```

Queries always:
- Use **prepared statements** with `?` bind parameters (no string interpolation)
- **Eager-load** related data via JOINs (no N+1 lazy loads)
- Select columns **explicitly** (no `SELECT *`)
- Filter soft-deleted rows with `WHERE IsDeleted = 0` by default

### Models
`src/models/` defines interfaces + factory functions. Factory functions set all defaults explicitly:

```typescript
export function createTransaction(fields: Partial<...>): Omit<Transaction, "id"> {
  return { isDeleted: false, isCash: false, isIncome: false, transactionTags: [], ...fields };
}
```

Objects fetched from the DB must be passed through `withComputedProps()` to re-attach getters (`parsedAmount`, `parsedCurrency`) that are lost during JSON serialization.

### Test structure
Every test file that touches the DB must create a **fresh in-memory DB per test**:

```typescript
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest"; // always import, never globals
import type { Database } from "sql.js";
import { initDatabase } from "../../src/data/DatabaseService";

const WASM_PATH = resolve(__dirname, "../../node_modules/sql.js/dist/sql-wasm.wasm");
let wasmBinary: ArrayBuffer;
let db: Database;

beforeEach(async () => {
  if (!wasmBinary) wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
  db = await initDatabase(wasmBinary);
});
afterEach(() => { db.close(); });
```

Use **fixture factory functions** (local `make*` helpers) to build test objects with sensible defaults and override only what the test cares about:

```typescript
function makeTransaction(overrides: Partial<...> = {}) {
  return { rawContent: "raw", notificationTitle: "Revolut", ...overrides };
}
```

Capacitor plugins are mocked to no-ops in tests via vitest path alias pointing to `src/__mocks__/@capacitor/share.ts`. Do not try to call real native APIs in tests.

### Naming
- **DB tables & columns**: PascalCase (`Transactions`, `ReceivedAt`, `IsDeleted`)
- **TypeScript variables & functions**: camelCase (`getAllTransactions`, `isDeleted`)
- **Interfaces & types**: PascalCase (`Transaction`, `UseTransactionsResult`)
- **Constants**: UPPER_SNAKE_CASE (`REVOLUT_PACKAGE`, `DEFAULT_CURRENCY`)

### React hooks
Hooks in `src/hooks/` own all screen state. Components are stateless renderers that call a hook. Hooks return a typed result interface (e.g., `UseTransactionsResult`). Hooks accept optional injectable dependencies (e.g., `share?: ShareFn`) so they can be tested without native plugins.

| Hook | Purpose | Key return fields |
|---|---|---|
| `useTransactions` | Transaction list + mutations | `transactions`, `loading`, `showDeleted`, `softDeleteTransaction`, `addManualTransaction`, `exportTransactions`, `addTagToTransaction` |
| `useEditTransaction` | Edit-transaction form state | `title`, `description`, `isCash`, `isIncome`, `amount`, `currency`, `currentTags`, `recentTags`, `save` |
| `useDashboard` | Spending analytics | `summary`, `incomeSummary`, `byTag`, `byMonth`, `byVendor`, `untaggedCount`, `period`, `availableTags`, `selectedTagIds` |

### IngestionService smart behaviour order
When extending ingestion logic, the sequence is **fixed** and must not be reordered:
1. Deduplication check (±5 second window, same title + body + package)
2. Persist new transaction
3. Auto-soft-delete (if a previously-deleted identical-title variant exists)
4. Auto-tag by vendor (copy tags from the most recent transaction with the same title)

`ingestNotification()` returns the persisted `Transaction` (possibly soft-deleted) or `null` if a duplicate was skipped.

### Currency parsing
`parseAmountAndCurrency()` in `NotificationServiceCore` matches **six** formats in priority order:
1. Hungarian payment sentence: `1 599 Ft összeget fizettél...`
2. European: `1.234,56 EUR`
3. Space-separated trailing code: `6 337 Ft`
4. Code-prefixed: `HUF 1 234`
5. US: `$1,234.56` or `1,234.56 USD`
6. Bare number (no currency detected)

Default currency when none is detected: `HUF`.

Symbol → currency code map: `$→USD`, `€→EUR`, `£→GBP`, `¥→JPY`, `₹→INR`, `₽→RUB`, `₣→CHF`, `₩→KRW`.

### Additional services

**ImportService** (`src/services/ImportService.ts`) — bulk import from app-exported CSV or JSON:
```typescript
export function importTransactions(db: Database, content: string): ImportResult
// ImportResult: { imported: number; skipped: number; errors: string[] }
// CSV column order: ReceivedAt, NotificationTitle, NotificationBody, PackageName,
//                  Amount, Currency, IsCash, Tags (;-separated), IsDeleted
```

**RevolutImportService** (`src/services/RevolutImportService.ts`) — parse Revolut's own CSV export:
```typescript
export function importRevolutCsv(db: Database, csvContent: string): RevolutImportSummary
// RevolutImportSummary: { imported: number; skipped: number }
// Skipped types: ["Átváltás"] (FX conversions)
// Handled types: Kártyás fizetés, Átutalás, Feltöltés, Kártyás visszatérítés
// Dedup window: ±1 day
```

**SplitTransactionService** (`src/services/SplitTransactionService.ts`) — split one transaction into parts:
```typescript
export function splitTransaction(db: Database, parentId: number, spec: SplitSpec): SplitResult
// SplitSpec: { mode: "fraction"; fractions: number[] }  — must sum to 1.0 ±0.01
//          | { mode: "amount"; amounts: number[] }      — must be < parent; remainder = final child
// Each child inherits parent metadata + non-"AddedManually" tags + "SplitFrom:{parentId}" tag.
// Parent is soft-deleted after splitting.
```

### DashboardRepository
`src/data/DashboardRepository.ts` provides analytics queries. All functions accept optional `startDate`, `endDate`, and `tagIds` filters. Base filter: `IsDeleted = 0 AND IsIncome = 0 AND Amount IS NOT NULL`.

```typescript
getSpendingSummary(db, startDate?, endDate?, tagIds?): SpendingSummary
getIncomeSummary(db, startDate?, endDate?, tagIds?): SpendingSummary
getSpendingByTag(db, ...): SpendingByTag[]     // includes "Untagged" entry
getSpendingByMonth(db, ...): SpendingByMonth[]  // YYYY-MM keys
getIncomeByMonth(db, ...): SpendingByMonth[]
getSpendingByVendor(db, ...): SpendingByVendor[] // top 10
getUntaggedTransactionCount(db, startDate?, endDate?): number
```

### useDashboard periods
`DashboardPeriod = "month" | "3months" | "6months" | "9months" | "12months"` — filters analytics to the last 1/3/6/9/12 months from today. Tag filter via `selectedTagIds` (empty = all tags).

### UI structure
- **Bottom nav bar** in `App.tsx` — Dashboard and Transactions icons with active state highlighting
- **Floating action button** (+) on Transactions page opens slide-up Add Transaction modal
- **Tag cloud filter** behind filter icon toggle on Transactions page (animated roll-down)
- **Pull-to-refresh** with touch gesture detection on both Dashboard and Transactions pages
- **DateTime picker** using native `<input type="datetime-local">` on Add and Edit Transaction forms
- All styling is inline React `CSSProperties` — no CSS framework. Dark theme (#121212 base)
