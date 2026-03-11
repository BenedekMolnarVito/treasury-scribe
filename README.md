# Treasury Scribe

A passive, **offline-first Android budgeting app** that captures Revolut push notifications automatically, parses the financial data, and lets you tag, edit, and export your transactions — with zero cloud dependencies. All data stays on-device.

---

## Features

### Automatic Transaction Capture
- Listens for Revolut push notifications via a thin Kotlin `NotificationListenerService` bridge
- Parses amount and currency from notification text (supports European `1.234,56 EUR`, Hungarian `6 337 Ft`, US `$1,234.56`, and plain `HUF 1 234` formats; defaults to HUF)
- Runs as a foreground service — works even when the app is in the background

### Smart Ingestion Behaviors
- **Deduplication** — ignores duplicate notifications within a ±5-second window
- **Auto-soft-delete** — if a previously-deleted version of the same transaction reappears, it is silently suppressed
- **Auto-tagging by vendor** — new transactions from a known vendor automatically inherit the tags from the most recent matching transaction
- **Manual entry auto-tag** — manually added transactions are always tagged `AddedManually`

### Transaction Management
- Add transactions manually (title, description, amount, currency, cash flag)
- Edit title, description, mark as cash or income
- Soft-delete individual transactions or clear all at once
- Toggle visibility of soft-deleted transactions
- Swipe left on a card to delete with a confirmation dialog

### Tagging
- Free-form tag creation and assignment per transaction
- Tag search with debounced suggestions (300 ms, 2+ characters)
- Quick-add word cloud showing the 5 most-used tags
- Tags are shown as a comma-separated line on each transaction card

### Transaction List UI
- Cards colour-coded: light yellow = untagged, light green = tagged
- Amount shown in red (expense) or dark green (income)
- Tap any card to open the edit screen

### Export
- Export all non-deleted transactions as **JSON** or **CSV** via the Android Share sheet
- CSV columns: `Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName, Amount, Currency, IsCash, Tags, IsDeleted`
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
  data/            — DatabaseService, TransactionRepository, TagRepository
  services/        — NotificationService, IngestionService
  hooks/           — useTransactions, useEditTransaction
  components/      — TransactionsPage, EditTransactionPage
  plugins/         — NotificationListenerPlugin (Capacitor bridge TS interface)
android/
  app/src/main/    — Kotlin NotificationListenerPlugin + AndroidManifest
csv_transformer_service/
  transform_csv.py — Post-export CSV → spreadsheet converter
tests/             — Vitest test suite mirroring src/ structure
```
