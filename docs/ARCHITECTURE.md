# VitoBudgetTracker Architecture

> **Last updated**: February 2026 — reflects the current state after migration from .NET MAUI to React + TypeScript + Capacitor.

## Overview

VitoBudgetTracker is a **React + TypeScript web application** (deployed to Android via Capacitor) that passively captures Revolut push notifications, stores them with parsed financial metadata in a local SQLite database (sql.js), and provides a React component-driven UI for viewing, editing, tagging, and exporting transactions. The project also includes a standalone Python CSV transformer for post-export analysis.

### Key Characteristics
- **Android-only** — deployed as a Capacitor Android app; notification capture uses a thin Kotlin Capacitor plugin bridge to Android's `NotificationListenerService`
- **Offline-first** — all data stays on-device; no network communication
- **Background notification listener** — uses Android's `NotificationListenerService` via a Capacitor plugin bridge, bound by the OS
- **TDD-driven** — strict test-first development with Vitest

---

## High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Android OS                                │
│                                                                      │
│   Revolut App ──► Push Notification ──► NotificationListenerService  │
│                          (Kotlin Capacitor Plugin Bridge)             │
│                                                                      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     VitoBudgetTracker App                             │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              CAPACITOR PLUGIN LAYER (Kotlin)                 │    │
│  │  NotificationListenerPlugin (Capacitor bridge)               │    │
│  │  - Receives notifications from Android OS                    │    │
│  │  - Forwards to TypeScript via Capacitor event bridge         │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              SERVICES LAYER (TypeScript Business Logic)      │    │
│  │  NotificationService                                         │    │
│  │  - isRevolutNotification() — package validation              │    │
│  │  - parseAmountAndCurrency() — regex amount extraction        │    │
│  │  - createTransactionFromNotification() — model creation      │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              DATA ACCESS LAYER (Repositories)                │    │
│  │  TransactionRepository                                       │    │
│  │  - CRUD + soft-delete + deduplication + vendor lookup         │    │
│  │  TagRepository                                               │    │
│  │  - CRUD + search + transaction linking + usage stats          │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              DATABASE LAYER (sql.js / SQLite)                │    │
│  │  DatabaseService                                             │    │
│  │  ┌───────────────┐  ┌────────┐  ┌──────────────────┐       │    │
│  │  │  Transactions  │──│  Tags  │──│  TransactionTags │       │    │
│  │  └───────────────┘  └────────┘  └──────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              │ Read / Write                          │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              PRESENTATION LAYER (React)                      │    │
│  │                                                               │    │
│  │  Custom Hooks:                                                │    │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐      │    │
│  │  │ useTransactions     │  │ useEditTransaction        │      │    │
│  │  └─────────┬───────────┘  └────────────┬─────────────┘      │    │
│  │            │                            │                     │    │
│  │            ▼                            ▼                     │    │
│  │  React Components:                                            │    │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐      │    │
│  │  │  TransactionsPage   │  │  EditTransactionPage      │      │    │
│  │  └─────────────────────┘  └──────────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│              EXTERNAL TOOLING (Python)                                │
│  csv_transformer_service/transform_csv.py                            │
│  - Post-export CSV simplification for spreadsheet analysis           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Layer Descriptions

### 1. Presentation Layer (React)

#### React Components

| Component | Responsibility |
|-----------|----------------|
| **TransactionsPage** | Main screen — transaction list, header buttons (Add, Refresh, Export, Clear All), "Show deleted" toggle, swipe-to-delete, tap-to-edit navigation, color-coded tagging indicators, loading spinner. |
| **EditTransactionPage** | Edit screen — form fields for title/description/IsCash/IsIncome, tag management (add, remove, search with debounce, quick-add word cloud of top-5 tags), save button. Dark theme. Created fresh for each edit to avoid stale state. |
| **App** | Root component with React Router navigation. |

#### Custom Hooks

| Hook | Responsibility |
|------|----------------|
| **useTransactions** | Central orchestrator for the main screen. Manages transaction state. Handles: load/refresh, soft-delete (single + bulk), manual transaction creation, tag management (add/remove/search), JSON/CSV export, duplicate checking. |
| **useEditTransaction** | Manages edit form state. Holds editable copies of transaction fields. Provides save logic to sync changes back into the model. Manages tag and recent-tag state. |

**Architectural decision — Custom Hooks instead of MVVM**: React's hooks pattern replaces the MVVM pattern from the .NET MAUI version. Custom hooks encapsulate state management and business logic, keeping components focused on rendering. This is idiomatic React and achieves the same separation of concerns.

### 2. Services Layer (TypeScript Business Logic)

| Service | Key Methods |
|---------|-------------|
| **NotificationService** | `isRevolutNotification(packageName)` — exact match against `com.revolut.revolut`. `parseAmountAndCurrency(text)` — regex supporting European (`1.234,56`), US (`1,234.56`), symbol-prefixed (`$50`), and space-separated (`6 337 Ft`) formats. `createTransactionFromNotification(title, body, packageName)` — builds a complete `Transaction` with JSON metadata, parsed Amount/Currency (defaulting to HUF). |

**Architectural decision — JSON handling**: TypeScript's native `JSON.parse()` and `JSON.stringify()` handle all JSON operations. No additional JSON libraries are needed.

### 3. Data Access Layer (Repositories)

| Repository | Key Capabilities |
|------------|-----------------|
| **TransactionRepository** | Standard CRUD. Plus: `softDeleteTransaction` / `softDeleteAllTransactions` (bulk SQL UPDATE). `existsDuplicate` (±5-second window deduplication). `findSoftDeletedMatch` (auto-soft-delete recurring unwanted notifications). `findLastTransactionByTitle` (auto-tagging by vendor). `getAllTransactionsIncludingDeleted` (toggle deleted visibility). All queries join `TransactionTags → Tags` for eager loading. |
| **TagRepository** | Standard CRUD. Plus: `searchTags` (LIKE query, min 2 chars, ordered by usage count, max 10 results). `getMostCommonTags` (top-N by transaction count). `getTagsOrderedByLastUsed`. `addTagToTransaction` / `removeTagFromTransaction` with duplicate prevention. `addTag` is idempotent — returns existing tag if name already exists. Automatically updates `Tag.lastUsedAt` when linking. |

**Architectural decision — Repository pattern over direct SQL**: Repositories provide a clean testable interface, centralize query logic (filters, joins, ordering), and encapsulate raw SQL behind typed TypeScript functions.

### 4. Database Layer

#### DatabaseService (sql.js)

- **Provider**: sql.js (SQLite compiled to WebAssembly)
- **Tables**: `Transactions`, `Tags`, `TransactionTags`
- **Initialization**: `DatabaseService` initializes sql.js, creates the database and all required tables via `CREATE TABLE IF NOT EXISTS` statements
- **Schema configuration**:
  - `Tag.Name` has a unique index
  - `TransactionTag` has a unique composite index on `(TransactionId, TagId)`
  - `ON DELETE CASCADE` on both FK relationships

#### Database Schema

**Transactions Table**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| RawContent | TEXT | NULLABLE | Plain-text notification content |
| JsonContent | TEXT | NULLABLE | Structured JSON with all metadata |
| ReceivedAt | TEXT | NOT NULL | ISO 8601 UTC timestamp |
| NotificationTitle | TEXT | NULLABLE | Notification title (vendor name) |
| NotificationBody | TEXT | NULLABLE | Notification body text |
| PackageName | TEXT | NULLABLE | Source app package name |
| IsDeleted | INTEGER | NOT NULL, DEFAULT 0 | Soft-delete flag |
| IsCash | INTEGER | NOT NULL, DEFAULT 0 | Cash transaction flag |
| Amount | REAL | NULLABLE | Parsed monetary amount |
| Currency | TEXT | NULLABLE | Currency code (default: HUF) |
| IsIncome | INTEGER | NOT NULL, DEFAULT 0 | Income vs. expense flag |

**Tags Table**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| Name | TEXT | NOT NULL, UNIQUE INDEX | Tag label |
| LastUsedAt | TEXT | NOT NULL | Last time tag was applied |

**TransactionTags Table** (Join)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| Id | INTEGER | PK, AUTOINCREMENT | Unique identifier |
| TransactionId | INTEGER | FK → Transactions, CASCADE | Transaction reference |
| TagId | INTEGER | FK → Tags, CASCADE | Tag reference |
| CreatedAt | TEXT | NOT NULL | When the tag was applied |

**Indexes**: `UNIQUE(TransactionTags.TransactionId, TransactionTags.TagId)`, `UNIQUE(Tags.Name)`

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

The Android notification listener is implemented as a thin Capacitor plugin bridge written in Kotlin. This plugin:

| Component | Type | Responsibility |
|-----------|------|----------------|
| **NotificationListenerPlugin** | Capacitor Plugin (Kotlin) | Bridges Android's `NotificationListenerService` to the TypeScript layer via Capacitor's event system. Receives notifications from the OS, validates the package, extracts title/body, and forwards them to the TypeScript service layer for processing and storage. |

**Architectural decision — thin native bridge**: Only the notification listener requires native Android code. All business logic (parsing, deduplication, auto-tagging, storage) lives in TypeScript, making it testable without Android tooling. The Kotlin plugin is kept as thin as possible — it only forwards raw notification data to the web layer.

**Architectural decision — Capacitor over direct native**: Capacitor provides a clean bridge between the web app and native Android APIs. This allows the vast majority of the app to be written in TypeScript while only the notification capture (which requires a native `NotificationListenerService`) uses Kotlin.

### 6. CSV Transformer Service (Python)

A standalone Python 3.6+ script with no external dependencies:

- **Input**: Exported CSV files from VitoBudgetTracker (placed in `csv_transformer_service/`)
- **Output**: Simplified 5-column CSV files in `csv_transformer_service/outputs/`
- **Columns**: `Nap` (date as `YYYY.MM.DD`), `Megnevezés` (title), `Tag` (tags), `Kiadás` (amount), `Currency`
- **Amount logic**: Uses the `Amount` field if present; otherwise extracts the first number followed by "Ft" from `NotificationBody` using regex
- **Batch processing**: Processes all `.csv` files in the folder automatically

---

## Domain Models

### Transaction

```typescript
interface Transaction {
    // Persisted properties
    id: number;                              // PK, autoincrement
    rawContent: string | null;               // Plain-text notification
    jsonContent: string | null;              // Full JSON metadata
    receivedAt: string;                      // ISO 8601 UTC timestamp
    notificationTitle: string | null;        // Vendor name / notification title
    notificationBody: string | null;         // Notification body text
    packageName: string | null;              // Source app (com.revolut.revolut or Manual)
    isDeleted: boolean;                      // Soft-delete flag (default: false)
    isCash: boolean;                         // Cash transaction flag (default: false)
    amount: number | null;                   // Parsed monetary amount
    currency: string | null;                 // Currency code (default: HUF)
    isIncome: boolean;                       // Income vs expense (default: false)

    // Computed (derived from jsonContent at runtime)
    parsedAmount: number | null;             // Falls back to jsonContent.amount if amount is null
    parsedCurrency: string | null;           // Falls back to jsonContent.currency if currency is null

    // Loaded via JOIN
    transactionTags: TransactionTag[];       // Many-to-many with Tag
}
```

### Tag

```typescript
interface Tag {
    id: number;                              // PK, autoincrement
    name: string;                            // Required, unique index
    lastUsedAt: string;                      // Updated when applied to a transaction
    transactionTags: TransactionTag[];       // Navigation
}
```

### TransactionTag (Join Entity)

```typescript
interface TransactionTag {
    id: number;                              // PK, autoincrement
    transactionId: number;                   // FK → Transaction (cascade delete)
    tagId: number;                           // FK → Tag (cascade delete)
    createdAt: string;                       // Audit timestamp
    // Unique index on (transactionId, tagId) prevents duplicates
}
```

---

## Design Patterns & Architectural Decisions

### 1. Repository Pattern

**Why**: Abstracts raw SQL queries behind clean typed TypeScript functions. Enables:
- Unit testing with real in-memory sql.js databases (no mocks needed for data layer)
- Centralized query logic (soft-delete filtering, JOINs, ordering)

```typescript
// TransactionRepository key functions
getAllTransactions(db): Transaction[]                    // Non-deleted, newest first, with tags
getAllTransactionsIncludingDeleted(db): Transaction[]
getTransactionById(db, id): Transaction | null
addTransaction(db, transaction): void
updateTransaction(db, transaction): void
deleteTransaction(db, id): void                         // Hard delete (used in tests)
softDeleteTransaction(db, id): void                     // Production path
softDeleteAllTransactions(db): void                     // Bulk SQL UPDATE
existsDuplicate(db, ...): boolean                       // ±5s deduplication window
findSoftDeletedMatch(db, ...): Transaction | null       // Auto-soft-delete recurring
findLastTransactionByTitle(db, ...): Transaction | null // Auto-tagging by vendor
```

### 2. Custom Hooks Pattern (React)

**Why**: Separates state management and business logic from UI rendering. Enables unit testing of hooks without rendering components.

- **Model**: `Transaction`, `Tag`, `TransactionTag` (TypeScript interfaces + factory functions)
- **Component**: `TransactionsPage`, `EditTransactionPage` (React components)
- **Hook**: `useTransactions`, `useEditTransaction` (state + logic)
- **Binding**: React state (`useState`, `useEffect`) drives component re-renders

**Why Custom Hooks over a state management library**: The app has a small state surface. With only two main views and straightforward data flow, React's built-in hooks provide sufficient state management without adding Redux, Zustand, or similar libraries.

### 3. Module-based Architecture

**Why**: Clean separation of concerns and tree-shaking friendly. All services, repositories, and hooks are plain TypeScript modules imported where needed.

```typescript
// Services and repositories are plain functions or classes
// imported directly — no DI container needed
import { getAllTransactions } from '../data/transactionRepository';
import { createTransactionFromNotification } from '../services/notificationService';
```

**Why no DI container**: TypeScript module imports provide natural dependency management. For testing, sql.js in-memory databases are passed directly to repository functions. The simplicity of the app (two pages, a few services) doesn't warrant a DI framework.

### 4. Capacitor Plugin Bridge

**Why**: Only the notification listener requires native Android APIs. Using Capacitor as the bridge keeps all business logic in TypeScript (testable without Android tooling) while providing access to the `NotificationListenerService` via a thin Kotlin plugin.

### 5. Soft Deletion Pattern

**Why**: Preserving deleted transactions enables the auto-soft-delete feature — if a user deletes a recurring notification (e.g., balance alerts), future identical notifications are automatically hidden. Hard deletion (`DeleteTransactionAsync`) exists only for test cleanup.

### 6. Capacitor Android Foreground Service

**Why**: Android OEMs (especially Xiaomi/POCO with MIUI/HyperOS) aggressively kill background processes. The Kotlin Capacitor plugin runs the notification listener as a foreground service to maximize the chance of continuous notification capture.

---

## Data Flow Diagrams

### Notification Capture (Automatic)

```
Revolut App sends push notification
         │
         ▼
Android OS delivers to NotificationListenerService (Kotlin Capacitor plugin)
         │
         ├─ isRevolutNotification(packageName)? ── No ──► Ignore
         │
         ▼ Yes
Extract title + body from Notification extras
         │
         ▼
Forward to TypeScript via Capacitor event bridge
         │
         ▼
NotificationService.createTransactionFromNotification(title, body, package)
  ├─ parseAmountAndCurrency(body) → { amount, currency }
  └─ Build Transaction object with JSON metadata
         │
         ▼
Repository operations (sql.js)
         │
         ├─ existsDuplicate(±5s window)? ── Yes ──► Skip
         │
         ▼ No
addTransaction(transaction)
         │
         ├─ findSoftDeletedMatch(title, body)?
         │     └─ Match found ──► softDeleteTransaction() → done
         │
         ▼ No match
findLastTransactionByTitle(title)?
         │
         └─ Has tags (excl. "AddedManually") ──► Copy tags to new transaction
```

### Transaction Display

```
User opens app / component mounts
         │
         ▼
useTransactions hook → loadTransactions()
         │
         ▼
TransactionRepository.getAllTransactions(db)
  └─ WHERE isDeleted = 0, ORDER BY receivedAt DESC, JOIN TransactionTags → Tags
         │
         ▼
React state updated → component re-renders
         │
         ▼
Transaction list renders cards
  ├─ Yellow background: 0 tags (untagged)
  ├─ Green background: 1+ tags (tagged)
  ├─ Red amount text: expense (isIncome = false)
  └─ Green amount text: income (isIncome = true)
```

### Manual Transaction Addition

```
User taps "Add Transaction"
         │
         ▼
Sequential prompts: title → description → amount → currency → isCash
         │
         ▼
useTransactions.addManualTransaction()
  ├─ Create Transaction (packageName = "Manual")
  ├─ addTransaction(db, transaction)
  ├─ TagRepository.addTag(db, "AddedManually")
  └─ TagRepository.addTagToTransaction(db, ...)
         │
         ▼
loadTransactions() → UI refreshes
```

### Export Flow

```
User taps "Export" → selects JSON or CSV
         │
         ├─ JSON: JSON.stringify (camelCase, indented)
         └─ CSV: Build CSV string with headers + escaped data rows
         │
         ▼
Save/share file via Capacitor Filesystem / Share plugin
         │
         ▼ (Optional)
User imports CSV into csv_transformer_service/
         │
         ▼
python transform_csv.py → simplified CSV in outputs/
```

---

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **UI Framework** | React | 18 | Component-based UI |
| **Language** | TypeScript | 5.x | Primary language |
| **Build Tool** | Vite | 7.x | Dev server and bundler |
| **Native Bridge** | Capacitor | 8.x | Android native API access |
| **Database** | sql.js | 1.14 | SQLite compiled to WebAssembly |
| **Routing** | React Router | 6.x | Client-side navigation |
| **Testing** | Vitest | 4.x | Test framework |
| **Testing Utils** | Testing Library | 16.x | React component testing |
| **Scripting** | Python | 3.6+ | CSV post-processing |

---

## Project Structure

```
vito-budget-tracker/
├── package.json                             # Dependencies and scripts
├── tsconfig.json                            # TypeScript configuration
├── vite.config.ts                           # Vite build configuration
├── index.html                               # Entry HTML
├── README.md                                # Project overview
├── LICENSE                                  # MIT License
│
├── docs/
│   ├── ARCHITECTURE.md                      # This document
│   ├── BUSINESS_LOGIC.md                    # Business logic & user flows
│   ├── CONTRIBUTING.md                      # Contribution guidelines
│   └── DEVELOPMENT.md                       # Development setup guide
│
├── src/
│   ├── main.tsx                             # React entry point
│   ├── App.tsx                              # Root component with routing
│   ├── index.css                            # Global styles
│   ├── vite-env.d.ts                        # Vite type declarations
│   │
│   ├── models/                              # TypeScript interfaces + factory functions
│   │   ├── Transaction.ts                   # Core entity interface + helpers
│   │   ├── Tag.ts                           # Tag entity interface
│   │   └── TransactionTag.ts                # Join entity interface
│   │
│   ├── data/                                # Database service + repositories (sql.js)
│   │   ├── DatabaseService.ts               # sql.js initialization + schema
│   │   ├── TransactionRepository.ts         # Transaction CRUD + smart queries
│   │   └── TagRepository.ts                 # Tag CRUD + search + linking
│   │
│   ├── services/                            # Business logic services
│   │   └── NotificationService.ts           # Notification parsing + validation
│   │
│   ├── hooks/                               # React custom hooks
│   │   ├── useTransactions.ts               # Main page state + logic
│   │   └── useEditTransaction.ts            # Edit page state + logic
│   │
│   ├── components/                          # React UI components
│   │   ├── TransactionsPage.tsx             # Main page component
│   │   └── EditTransactionPage.tsx          # Edit page component
│   │
│   ├── plugins/                             # Capacitor plugin bridges
│   │   └── NotificationListenerPlugin.ts    # TypeScript side of notification bridge
│   │
│   └── types/                               # TypeScript declarations
│       └── sql.js.d.ts                      # sql.js type augmentations
│
├── tests/
│   ├── setup.ts                             # Vitest global setup (sql.js init)
│   ├── models/                              # Model tests
│   │   └── models.test.ts                   # Model property + JSON parsing tests
│   ├── data/                                # Repository tests (real SQLite via sql.js)
│   │   ├── DatabaseContext.test.ts          # DB creation + schema tests
│   │   ├── TransactionRepository.test.ts    # Full CRUD + dedup + soft-delete tests
│   │   └── TagRepository.test.ts            # Tag CRUD + search + linking tests
│   └── services/                            # Service + integration tests
│       ├── NotificationService.test.ts      # Notification parsing + validation tests
│       ├── TransactionService.test.ts       # Transaction service mock + integration tests
│       └── EditTransactionService.test.ts   # Edit service tests
│
└── csv_transformer_service/
    ├── README.md                            # Transformer documentation
    ├── transform_csv.py                     # Python CSV transformer script
    ├── transactions_*.csv                   # Sample input files
    └── outputs/                             # Transformed output files
```
│
└── csv_transformer_service/
    ├── README.md                            # Transformer documentation
    ├── transform_csv.py                     # Python CSV transformer script
    ├── transactions_*.csv                   # Sample input files
    └── outputs/                             # Transformed output files
```

---

## Security & Privacy

| Aspect | Implementation |
|--------|---------------|
| **Notification access** | Requires explicit user opt-in via system settings; Capacitor plugin bridges to Android's `NotificationListenerService` |
| **Data storage** | SQLite via sql.js in app-private storage; inaccessible to other apps |
| **Data transmission** | None — no network calls, no analytics SDKs |
| **Package validation** | Only `com.revolut.revolut` notifications are processed; all others rejected |
| **Data lifecycle** | Database auto-deleted on app uninstall |
| **Export** | User-initiated only; file shared via Capacitor Share plugin |

---

## Performance Considerations

| Area | Approach |
|------|----------|
| **Database I/O** | sql.js runs SQLite synchronously in WebAssembly. Bulk operations use single SQL statements for efficiency. |
| **UI responsiveness** | React's virtual DOM and state-driven rendering keep the UI responsive. Heavy operations can be deferred with `useEffect`. |
| **Memory** | sql.js database is held in memory as a single instance. Transaction data is loaded on demand. |
| **Eager loading** | Repository queries use JOINs to load `TransactionTags → Tags` in a single query to avoid N+1 problems. |
| **Debounced search** | Tag search in the edit page uses debounce to avoid flooding the database with queries on every keystroke. |

---

## Testing Strategy

### Test Architecture

- **Framework**: Vitest
- **Database**: Real in-memory sql.js databases per test (no mocks needed for data layer)
- **Cleanup**: Each test creates a fresh sql.js database instance; no file cleanup needed (in-memory only)

### Test Coverage by Layer

| Layer | Test File | What's Tested |
|-------|-----------|---------------|
| **Models** | `models.test.ts` | Property defaults, `parsedAmount`/`parsedCurrency` fallback from `jsonContent`, `amount`/`currency` precedence |
| **Models** | `models.test.ts` | Tag property behavior, defaults |
| **Models** | `models.test.ts` | TransactionTag relationship properties |
| **Data** | `DatabaseContext.test.ts` | DB creation, table existence, schema correctness |
| **Data** | `TransactionRepository.test.ts` | Full CRUD, soft-delete, bulk delete, deduplication, soft-deleted match, vendor lookup, JOIN/ordering |
| **Data** | `TagRepository.test.ts` | Tag CRUD, search, most-common, ordered-by-last-used, transaction linking/unlinking, idempotent add |
| **Services** | `NotificationService.test.ts` | Package validation, amount/currency parsing (multiple formats), transaction creation, JSON structure |

### Test Database Pattern

```typescript
import initSqlJs, { Database } from 'sql.js';

describe('SomeRepository', () => {
    let db: Database;

    beforeEach(async () => {
        const SQL = await initSqlJs();
        db = new SQL.Database();
        // Create tables...
    });

    afterEach(() => {
        db.close();
    });

    it('should do something', () => {
        // test using db
    });
});
```

---

## Android Permissions (Capacitor)

The Capacitor Android project requires the following permissions in `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

| Permission | Why |
|-----------|-----|
| `BIND_NOTIFICATION_LISTENER_SERVICE` | Required for `NotificationListenerService` to receive notifications |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_SPECIAL_USE` | Keep the listener alive as a foreground service |
| `POST_NOTIFICATIONS` | Display the foreground service notification (Android 13+) |

---

## Onboarding Checklist for New Developers

### Prerequisites
- Node.js 18+
- npm
- Android Studio (only needed for Capacitor native plugin development)
- An Android physical device (POCO F5 recommended) — emulators do not reliably support `NotificationListenerService`

### Getting Started

```bash
# 1. Clone
git clone https://github.com/BenedekMolnarVito/vito-budget-tracker.git
cd vito-budget-tracker

# 2. Install dependencies
npm install

# 3. Run tests (no Android device needed)
npm test

# 4. Start dev server
npm run dev

# 5. Build
npm run build

# 6. Type check
npx tsc --noEmit
```

### Key Files to Read First
1. [App.tsx](../src/App.tsx) — Root component with routing
2. [models/](../src/models/) — Core domain model interfaces
3. [data/DatabaseService.ts](../src/data/DatabaseService.ts) — Database initialization and schema
4. [data/TransactionRepository.ts](../src/data/TransactionRepository.ts) — Transaction data access
5. [services/NotificationService.ts](../src/services/NotificationService.ts) — Notification processing logic
6. [hooks/](../src/hooks/) — Custom hooks with state management logic
7. [components/](../src/components/) — React UI components

### Development Workflow (TDD)
1. Write a failing Vitest test in `tests/`
2. Run `npm test` — confirm red
3. Implement the feature
4. Run `npm test` — confirm green
5. Refactor while keeping tests green
6. Build and deploy to device for manual verification

### Adding a New Feature (Template)

```
1. src/models/NewEntity.ts                   # TypeScript interface + factory
2. src/data/NewEntityRepository.ts           # Repository functions
3. src/services/NewEntityService.ts          # Business logic (if needed)
4. src/hooks/useNewEntity.ts                 # Custom hook for state + logic
5. src/components/NewEntityPage.tsx          # React component
6. src/App.tsx                               # Add route (if new page)
7. tests/.../NewEntity.test.ts              # Tests for each layer
```

---

## Debugging

### Development
```bash
# Start dev server with hot reload
npm run dev

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit
```

### Android-Specific (Capacitor)
```bash
# View app logs (when running on device via Capacitor)
adb logcat | grep "VitoBudgetTracker"

# Notification listener specifically
adb logcat | grep "NotificationListener"
```

### Test Notification
```bash
adb shell "cmd notification post -t 'Test Revolut' com.revolut.revolut 'You paid 50.00 USD at Store'"
```

### Listener Status
```bash
adb shell settings get secure enabled_notification_listeners
```
