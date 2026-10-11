# Fixed Requirements — Technical Reconnaissance Brief

> Source: read-only code recon of treasury-scribe (branch `feat/2026-10-03-change-reqs-planning`), 2026-10-03.
> This is background evidence for `implementation_plan_fixed_requirements.md`. Not a plan itself.

## Data model

- **Transaction** (`src/models/Transaction.ts`): `id, rawContent, jsonContent, receivedAt, notificationTitle (=Title), notificationBody (=Description), packageName, isDeleted (bool), isCash, amount, currency, isIncome, parsedAmount/parsedCurrency (computed getters), transactionTags: TransactionTag[]`.
- **Tag** (`src/models/Tag.ts`): `id, name, lastUsedAt, transactionTags`.
- **TransactionTag** (`src/models/TransactionTag.ts`): `id, transactionId, tagId, createdAt, tagName?`.
- DB tables: `Transactions(Id, IsDeleted, NotificationTitle, NotificationBody, Amount, Currency, IsCash, IsIncome, ReceivedAt, PackageName, RawContent, JsonContent)`, `Tags(Id, Name, LastUsedAt)`, `TransactionTags(Id, TransactionId, TagId, CreatedAt)`.

---

## FR1 — Export/Import metadata (retain IsDeleted; re-hide on import)

- **Current behavior**: Export (`src/hooks/useTransactions.ts:397-425`) calls `getAllTransactions(db)` which filters `WHERE IsDeleted=0` (`src/data/TransactionRepository.ts:160`), so deleted rows never reach the file. CSV header *does* include IsDeleted as column 10 (`useTransactions.ts:141-152`) and `transactionsToCSV` emits `tx.isDeleted?1:0` (line 199), but it's always 0. Import (`src/services/ImportService.ts:196`) has early-exit `if (row.isDeleted) return "skipped"`, and line 218 hardcodes `isDeleted:false`.
- **Change needed**:
  - (A) Export: `useTransactions.ts:399` → use `getAllTransactionsIncludingDeleted(db)`.
  - (B) Import: in `ImportService.ts importParsedRow` (195-231) remove the skip guard (196), insert with `isDeleted: row.isDeleted`; after `addTransaction`, if `row.isDeleted` call `softDeleteTransaction(db, savedTx.id)`. Still re-create tags regardless of isDeleted.
  - Update JSDoc at `useTransactions.ts:85-88`.
- **Existing tests (WILL BREAK — update them)**: `tests/services/ImportService.test.ts:186` ("skips IsDeleted=1 rows" CSV) and `:315` (JSON) encode the current wrong design and must be flipped to assert import-with-isDeleted:true. No round-trip test exists yet — add one.
- **Risks**: `EXPECTED_COLUMN_COUNT=10` already matches, no schema change. Old pre-fix exports (IsDeleted always 0) behave unchanged. Full-table scan slightly slower on large DBs — not architectural.

## FR2 — Auto-classification on Title + Description(minus numbers)

- **Current behavior**: `src/services/IngestionService.ts:84` calls `findLastTransactionByTitle(db, txData.notificationTitle)`. `src/data/TransactionRepository.ts:418-434` matches `WHERE IsDeleted=0 AND NotificationTitle IS ?` — **title only**. Recurring `Átutalás elküldve…` transfers share a title but differ in body/amount, so all get the same tags.
- **Change needed**:
  - Add `findLastTransactionByTitleAndBody(db, title, body)` in `TransactionRepository.ts` (after 435): `WHERE IsDeleted=0 AND NotificationTitle IS ? AND NotificationBody IS ? ORDER BY ReceivedAt DESC LIMIT 1`.
  - Add `stripNumbers(body)` helper in `IngestionService.ts` (e.g. `body.replace(/[\d.,]+/g,'').trim()`), null-safe.
  - In `IngestionService.ts` after line 84, also look up title+body (with stripped body) and **prefer the title+body hit; fall back to title-only** for tag propagation in step 5.
- **Existing tests**: `tests/services/IngestionService.test.ts:248-382` (auto-tag by vendor — still pass if additive); `tests/data/TransactionRepository.test.ts:437-480` (findLastTransactionByTitle — add sibling tests for the new fn). No "same title, different body" test exists — add one.
- **Risks**: Must be *prefer-then-fallback*, not replace, or previously title-tagged txns lose classification. `stripNumbers` regex must not be over-aggressive. Handle null body (bind null to `IS ?`). HU example: `Átutalás elküldve 15 000 Ft Kovács Jánosnak` → strips to `Átutalás elküldve  Ft Kovács Jánosnak`, still distinct per recipient.

## FR3 — Manual-add tagging (tag input in AddTransactionModal)

- **Current behavior**: `AddTransactionModal` (`src/components/TransactionsPage.tsx:281-448`) has NO tag state/UI (only title, description, amount, currency, isCash, isIncome, receivedAt). `addManualTransaction` (`src/hooks/useTransactions.ts:358-391`) only applies the auto `AddedManually` tag. Rendered at `TransactionsPage.tsx:1418` with `onAdd={addManualTransaction}`. `searchTags`/`addTagToTransaction` are returned by the hook (`useTransactions.ts:450-453`) but not destructured into `TransactionsPage` scope.
- **Change needed**:
  - Extend `AddTransactionModalProps` (260-276) with `searchTags` + `onAddTag` (or thread `tagNames`).
  - Add `addManualTransaction(... , tagNames?: string[])` to interface (73) + impl (358); after the AddedManually loop, add+attach each user tag.
  - In `AddTransactionModal`: `tagNames` state + `tagInput` state, a tag input + Add button + removable pills (between toggles at 432 and submit at 434); pass `tagNames` to `onAdd` in `handleSubmit` (302).
  - Update call site (1418) to pass `searchTags`/`onAddTag`.
  - Reuse the tag-search UX from `EditTransactionPage.tsx:264-280` + `useEditTransaction.ts:261-284` (candidate for extraction into a shared component).
- **Existing tests**: `tests/hooks/useTransactions.test.ts:257` (AddedManually — extend for user tags); `tests/components/TransactionsPage.test.ts:1050-1081` (modal income toggle — no tag coverage). Add tag-field presence + persistence tests.
- **Risks**: Make `tagNames?` optional to avoid breaking the sole call site. Full search+debounce+suggestions is significant UI; a simpler enter/comma-separated free-text input is an acceptable first cut.

## FR4 — Edit-view OS swipe-back

- **Current behavior**: `EditTransactionPage.tsx` uses react-router `useNavigate` (19/222). Back only happens via `handleSave` (283-286) and `handleSplit` (288-292) → `navigate('/transactions')`. No `navigate(-1)`, no `@capacitor/app` back listener. `@capacitor/app` is NOT in package.json. `App.tsx` (393-441) uses `BrowserRouter`. `MainActivity` extends `BridgeActivity` → default Android back calls `finish()` (exits app) rather than popping webview history.
- **Change needed**:
  - `npm install @capacitor/app`.
  - In `EditTransactionPage` content, `useEffect` registering `App.addListener('backButton', () => navigate('/transactions'))`, removed on unmount; guard dynamic import with try/catch for jsdom. Add a visible header Back button (`navigate(-1)`) too.
  - `BrowserRouter` is Capacitor-compatible — no change.
- **Existing tests**: `tests/components/EditTransactionPage.test.ts:509` (save-button nav via MemoryRouter). Add a test mocking `@capacitor/app` (`vi.mock`) asserting `addListener('backButton', …)` on mount + removal on unmount.
- **Risks**: Scope the listener to the edit component (not global in App.tsx) to avoid intercepting back on other routes. Unsaved-edits discard — consider a confirm dialog. Guard dynamic import for test env. `BridgeActivity` default may still `finish()`; may need `MainActivity.onBackPressed` override — verify against Capacitor 8 docs.

## Full test file list

`tests/App.test.ts, tests/AppLifecycle.test.tsx, tests/AppRefresh.test.tsx, tests/assets/icon.test.ts, tests/components/DashboardPage.test.ts, tests/components/EditTransactionPage.test.ts, tests/components/ToggleSwitch.test.ts, tests/components/TransactionsPage.test.ts, tests/data/DashboardRepository.test.ts, tests/data/DatabaseContext.test.ts, tests/data/TagRepository.test.ts, tests/data/TransactionRepository.test.ts, tests/DatabaseService.test.ts, tests/hooks/useDashboard.test.ts, tests/hooks/useEditTransaction.test.ts, tests/hooks/useTransactions.test.ts, tests/models/models.test.ts, tests/plugins/NotificationListenerPlugin.test.ts, tests/services/ImportService.test.ts, tests/services/IngestionService.test.ts, tests/services/NotificationService.test.ts, tests/services/RevolutImportService.test.ts, tests/services/SplitTransactionService.test.ts`
