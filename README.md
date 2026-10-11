# Treasury Scribe

A passive, **offline-first Android budgeting app** that captures Revolut push notifications automatically, parses the financial data, and lets you tag, edit, and export your transactions — with zero cloud dependencies. All data stays on-device.

---

## Features

### Automatic Transaction Capture
- Listens for Revolut push notifications via a thin Kotlin `NotificationListenerService` bridge
- Parses amount and currency from notification text (supports Hungarian payment sentences `1 599 Ft összeget fizettél…`, European `1.234,56 EUR`, space-separated `6 337 Ft`, code-prefixed `HUF 1 234`, US `$1,234.56` / `1,234.56 USD`, and bare numbers; defaults to HUF)
- Runs as a foreground service — works even when the app is in the background

### Smart Ingestion Behaviors
- **Deduplication** — ignores duplicate notifications within a ±5-second window
- **Auto-soft-delete** — if a previously-deleted version of the same transaction reappears, it is silently suppressed
- **Auto-tagging by vendor** — new transactions inherit tags from the most recent matching transaction, matched on title **and** description with parsed numbers stripped out (so e.g. different `Átutalás elküldve…` transfers classify independently)
- **Manual entry auto-tag** — manually added transactions are always tagged `AddedManually`
- **Default / Exception** — marking a transaction as an *Exception* clears its auto-assigned tags and excludes it from vendor auto-learning, so the next transaction at the same merchant still gets the default tags

### Transaction Management
- Add transactions manually via floating **+** button (slide-up modal with title, description, amount, currency, date/time, cash/income toggles, a **tag input**, and a **Default/Exception** switch)
- Edit title, description, amount, currency, date/time, mark as cash or income
- **Default/Exception** switch on both the edit screen and the manual-add modal
- Step back from the edit screen with the OS swipe-back gesture (via `@capacitor/app`)
- Soft-delete individual transactions or clear all at once
- Toggle visibility of soft-deleted transactions
- Swipe left on a card to delete with a confirmation dialog
- Split a transaction into fractional or fixed-amount parts
- Import transactions from an app-exported JSON/CSV file, or from Revolut's own CSV export

### Navigation & Layout
- **Bottom navigation bar** with Dashboard (default home) and Transactions tabs
- **Dashboard** at `/` — hero card, doughnut chart, monthly trend line chart, top vendors
- **Transactions** at `/transactions` — transaction list with compact icon toolbar
- Compact SVG icon buttons for Refresh, Export, Import, Revolut Import, Clear All

### Tagging
- Free-form tag creation and assignment per transaction
- Tag search with debounced suggestions (300 ms, 2+ characters)
- Quick-add word cloud of the most-used tags, **capped with a show-more toggle** so it stays compact
- Tags are shown as a comma-separated line on each transaction card
- **Tag cloud filter** — hidden behind a filter icon; tap to reveal animated tag chips for real-time filtering

### Dashboard
- Period pills in a **horizontally scrollable tab strip**: This Month, **Last Month**, 3 Months, 6 Months, 9 Months, 12 Months
- Tag-filtered doughnut chart (spending by tag)
- Trend line chart that **dynamically switches between monthly and weekly**: weekly when a single month is selected, monthly otherwise; refreshes when the period changes
- Top 10 vendors list
- Untagged transaction badge with one-tap classify navigation

### Transaction List UI
- Cards colour-coded: light yellow = untagged, light green = tagged
- Amount shown in red (expense) or dark green (income)
- Tap any card to open the edit screen
- **Pull-to-refresh** with animated circular arrow indicator and toast notification

### Export & Import
- Export all non-deleted transactions as **JSON** or **CSV** via the Android Share sheet
- Filenames include timestamp: `treasury-scribe-transactions_YYYYMMDD_HHMMSS.csv`
- CSV columns: `Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName, Amount, Currency, IsCash, Tags, IsDeleted`
- Export retains all metadata — including the `IsDeleted` flag — so re-importing an app export restores previously-deleted transactions as hidden (they stay auto-suppressed) rather than resurfacing them
- **Import** an app-exported JSON/CSV file back into the app, or import **Revolut's own CSV export** (card payments, transfers, top-ups, refunds; FX conversions are skipped; ±1-day dedup)
- Bundled Python script (`csv_transformer_service/transform_csv.py`) converts the exported CSV into a 5-column spreadsheet-ready format (`Nap, Megnevezés, Tag, Kiadás, Currency`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript 5 |
| Build | Vite 7 |
| Android bridge | Capacitor 8 |
| Database | sql.js 1.14 (SQLite via WebAssembly, on-device) |
| Routing | React Router 6 |
| Tests | Vitest 4 + Testing Library 16 |
| CSV transformer | Python 3.6+ (no external deps) |

---

## Install on a POCO F5 (or any Android device)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Android Studio](https://developer.android.com/studio) (for the Android SDK and `adb`)
- Java 17+ (bundled with Android Studio)
- A USB cable and the POCO F5 with **USB debugging enabled**

### 1 — Enable USB Debugging on the POCO F5

1. Go to **Settings → About phone → MIUI version** (or HyperOS version) and tap it **7 times** to unlock Developer Options.
2. Go to **Settings → Additional Settings → Developer Options**.
3. Enable **USB debugging**.
4. Enable **Install via USB**.
5. If prompted about MIUI optimisations, disable them — this allows sideloaded apps to stay alive in the background.

> **Important for notification capture:** After installing the app, grant **Notification Access** under **Settings → Notifications → Notification Access → Treasury Scribe**, and optionally exclude the app from battery optimisation under **Settings → Battery → Battery Saver → No restrictions**.

### 2 — Clone and install dependencies

```bash
git clone https://github.com/BenedekMolnarVito/treasury-scribe.git
cd treasury-scribe
npm install
```

### 3 — Build the web assets and sync to Android

```bash
npm run build
npx cap sync android
```

### 4 — Install directly to the connected POCO F5

Connect the phone via USB and accept any "Allow USB debugging" prompt on the device, then run:

```bash
npm run android:run
```

This command builds the web assets, syncs them to the Android project, compiles the APK with Gradle, and installs it to the connected device in one step.

Alternatively, open the Android project in Android Studio and run it from there:

```bash
npx cap open android
```

### 5 — Verify

Open Treasury Scribe on the phone. If Revolut is installed, trigger a test payment or transfer and the transaction should appear automatically within a second.

---

## Running Tests

```bash
npm test                         # Run all tests once
npm run test:watch               # Watch mode

# Single file:
npx vitest run tests/data/TransactionRepository.test.ts

# Tests matching a name:
npx vitest run --grep "deduplication"
```

All tests use a real in-memory sql.js database — no mocks for the data layer.

---

## Project Structure

```
src/
  models/          — Transaction, Tag, TransactionTag interfaces + factories
  data/            — DatabaseService, TransactionRepository, TagRepository, DashboardRepository
  services/        — NotificationService (facade) + NotificationServiceCore, IngestionService,
                     ImportService, RevolutImportService, SplitTransactionService
  hooks/           — useTransactions, useEditTransaction, useDashboard
  components/      — DashboardPage, TransactionsPage, EditTransactionPage,
                     SplitTransactionModal, ToggleSwitch
  pages/           — Thin re-exports of components (route-level clarity)
  plugins/         — NotificationListenerPlugin (Capacitor bridge TS interface)
android/
  app/src/main/kotlin/com/treasuryscribe/app/
                   — Kotlin plugin (NotificationListenerPlugin, RevolutNotificationService,
                     BootReceiver, ServiceRestartReceiver) + AndroidManifest
csv_transformer_service/
  transform_csv.py — Post-export CSV → spreadsheet converter
tests/             — Vitest test suite (23 files, 691 tests) mirroring src/ structure
.maestro/smoke/    — Deterministic CDP + Jev behavioral smoke harness for the change-req flows
```
