# Fixed Requirements — Implementation Plan

> **For Hermes:** Execute with the `superpowers:subagent-driven-development` skill, task-by-task. Dispatch a FRESH implementer subagent per task (never inherit this session's context), then run a task review (spec compliance + code quality) after each, and a whole-branch review at the end. Work on branch `feat/2026-10-03-change-reqs-planning` (already created). Do NOT begin until the user triggers execution.

**Goal:** Implement the 7 fixed change-requests (3 Dashboard, 4 Transactions) for treasury-scribe exactly as specified in `change_reqs.md`, with ≥95% coverage maintained and all tests + build green.

**Architecture:** React 18 + react-router-dom v6 + Capacitor 8 + sql.js 1.14, tested with vitest + @testing-library/react. Real components live in `src/components/` (the `src/pages/` versions are thin re-exports). Hand-rolled inline SVG charts (no chart library). Dark theme. HUF currency. All data on-device.

**Tech Stack:** TypeScript, React, sql.js (SQLite WASM), Capacitor plugins (local-notifications, share; `@capacitor/app` to be added for FR7).

**Companion recon brief (authoritative file/line references):** `docs/updates_2026_10_03/_recon_fixed_requirements.md` — read it before FR4–FR7.

---

## Global Constraints

- `npm run test` (vitest) and `npm run build` (vite) MUST pass before any task is marked complete. Every task adds/updates tests (TDD: failing test first).
- Follow existing code style: inline `STYLE` objects for CSS, `data-testid` on interactive/visual elements, dark-theme colors already defined in each component.
- Touch only what each task requires — no drive-by refactors or reformatting.
- Preserve existing `data-testid` values; add new ones for new UI.
- Commit after each task with Conventional Commits: `feat(dashboard): …` / `feat(transactions): …` / `fix(...)`.
- Do NOT commit the planning docs or `change_reqs.md` as part of implementation unless the user asks.

## Subagent routing (model tier per task)

Routing is by task complexity (resolve concrete model ids from `config.yaml` `model.aliases`):
- **quick** (haiku): single-file mechanical edits with complete spec in the brief → none pure here; use for trivial re-review of small fix diffs.
- **standard** (sonnet): well-scoped single/two-file changes with clear acceptance → FR1, FR2, FR3, FR5, FR6, FR7, FR8.
- **deep** (opus): multi-file coordination or design judgment → FR4 (manual-add tagging: modal + hook + call-site + shared tag-search UX) and the FINAL whole-branch review.

Dispatch the task reviewer at a tier scaled to the diff (standard for most; deep only for FR4's diff). Always specify the model explicitly.

---

## FR1 (Dashboard) — Month tabs: "Last month" after "This Month" + horizontal carousel scroll

**Objective:** Add individual month tabs (so the user can look back at the first days of a month), place a "Last Month" tab after "This Month", and make the overflowing tab row horizontally scrollable (carousel-like). Keep current button size.

**Files:**
- Modify: `src/components/DashboardPage.tsx` — `PERIOD_OPTIONS` (124-130), `PERIOD_LABELS` (132-138), `PeriodPills` component (177-190), `STYLE.pillRow` (70-74).
- Modify: `src/hooks/useDashboard.ts` — `DashboardPeriod` type (34), `MONTHS_FOR_PERIOD` (65-71), `periodStartDate` (79-86), `loadData` date-range handling (105-125).
- Modify: `src/data/DashboardRepository.ts` — add optional `endDate` to the by-month queries if a bounded single-month range is needed (currently `getSpendingByMonth`/`getIncomeByMonth` take only `startDate`).
- Test: `tests/components/DashboardPage.test.ts`, `tests/hooks/useDashboard.test.ts`.

**Design decisions (rule these in the brief):**
- Add a `"lastMonth"` period value. Order of tabs becomes: `This Month, Last Month, 3 Mo, 6 Mo, 9 Mo, 12 Mo`. (The CR says "Last month after this month".)
- `lastMonth` = the full previous calendar month (start = first day of previous month, end = last day of previous month). This requires an END bound, which the current period model lacks for the trend/summary queries — extend `loadData` to compute `{startDate, endDate}` per period and pass `endDate` through to `getSpendingByMonth`/`getIncomeByMonth` (add the optional param).
- Carousel: `STYLE.pillRow` gets `overflowX: "auto"`, `flexWrap: "nowrap"`, `WebkitOverflowScrolling: "touch"`, `scrollbarWidth: "none"` (+ `::-webkit-scrollbar { display:none }` via a style tag or inline wrapper), and each pill `flexShrink: 0`. Button size (`padding: "6px 14px"`, `fontSize: "0.85em"`) stays as-is.

**Steps (TDD):**
1. Write failing hook test: `useDashboard` with `period="lastMonth"` computes a start/end covering only the previous calendar month and `byMonth` is bounded to it.
2. Run → FAIL.
3. Extend `DashboardPeriod`, `MONTHS_FOR_PERIOD`, `loadData` to produce `{startDate,endDate}`; add `endDate` param to `getSpendingByMonth`/`getIncomeByMonth`; wire through.
4. Run hook test → PASS.
5. Write failing component test: `pill-lastMonth` renders between `pill-month` and `pill-3months`; `period-pills` row is horizontally scrollable (assert `overflowX: auto` / `flexWrap: nowrap` style or testid on a scroll wrapper).
6. Run → FAIL.
7. Update `PERIOD_OPTIONS`, `PERIOD_LABELS`, `PeriodPills`, `STYLE.pillRow`.
8. Run component test → PASS; run full suite + build.
9. Commit `feat(dashboard): add Last Month tab and horizontally scrollable month tabs`.

**Risks:** The current period model is start-only; adding an end bound touches summary/vendor/tag queries too — ensure `endDate` is threaded consistently or the hero numbers for "Last Month" will include later data. Verify `computeAvgPerDay` (154-166) handles `lastMonth` (full-month divisor, not day-of-month).

---

## FR2 (Dashboard) — Smaller tag cloud with "show more"

**Objective:** The tag filter chips row (`TagFilterChips`, acting as the "tag cloud") is too big; cap the initially visible chips and add a "show more" control at the bottom that reveals the rest.

**Files:**
- Modify: `src/components/DashboardPage.tsx` — `TagFilterChips` (244-292).
- Test: `tests/components/DashboardPage.test.ts`.

**Design decisions:**
- Default-visible cap: show first N chips (N=8) sorted by `count` descending (most-used first); hide the rest behind a `show more (N)` button at the BOTTOM of the chip row. Clicking toggles to show-all with a `show less` affordance.
- Preserve the existing `tag-filter` testid and the `tag-filter-clear` button; add `tag-filter-show-more` testid.
- Selected-but-hidden tags should still render (don't hide an active filter): always show selected chips plus the top-N unselected.

**Steps (TDD):**
1. Failing test: with 20 available tags, only 8 (+ any selected) chips render initially and a `tag-filter-show-more` button is present; clicking it reveals all.
2. Run → FAIL.
3. Add `showAll` state + slice/sort + show-more/less button to `TagFilterChips`.
4. Run → PASS; full suite + build.
5. Commit `feat(dashboard): cap tag cloud with show-more toggle`.

**Risks:** Sorting changes chip order — ensure the sort is stable and selected chips remain reachable. Keep button size consistent with existing chips.

---

## FR3 (Dashboard) — Weekly trend for single month; monthly otherwise; dynamic refresh

**Objective:** `MonthlyTrendChart` is meaningless when only one month is selected. When the selected period is a single month (`month` or new `lastMonth`), show a WEEKLY trend for that month; otherwise keep the monthly trend. Must refresh dynamically when the period changes.

**Files:**
- Modify: `src/components/DashboardPage.tsx` — `MonthlyTrendChart` (389-477), its call site (691), card title.
- Modify: `src/data/DashboardRepository.ts` — add `getSpendingByWeek`/`getIncomeByWeek` (group by `strftime('%Y-%W', ReceivedAt)` or ISO week), analogous to the by-month fns (208-226, 330-348).
- Modify: `src/hooks/useDashboard.ts` — expose `byWeek`/`incomeByWeek` (or a unified `trendBuckets` + `trendGranularity`) and recompute on period change in `loadData`.
- Test: `tests/components/DashboardPage.test.ts`, `tests/hooks/useDashboard.test.ts`, `tests/data/DashboardRepository.test.ts`.

**Design decisions:**
- Single-month detection: `period === "month" || period === "lastMonth"`. Introduce `trendGranularity: "weekly" | "monthly"` in the hook, derived from period; the component renders week labels (W1..W5 or date ranges) when weekly.
- The chart title switches between "Monthly Trend" and "Weekly Trend" (keep `monthly-chart` testid for back-compat OR add `trend-chart` testid; rule: keep `monthly-chart` and add `data-granularity` attr).
- Dynamic refresh already happens because `setPeriod` → `loadData`; verify the new week buckets are recomputed there (they must be fetched inside `loadData`, not memoized on stale period).

**Steps (TDD):**
1. Failing repo test: `getSpendingByWeek` buckets a month's transactions into weeks with correct totals.
2. Run → FAIL; implement week queries; PASS.
3. Failing hook test: `trendGranularity==="weekly"` for `month`/`lastMonth`, `"monthly"` for multi-month; week buckets populated for single month and refreshed on `setPeriod`.
4. Run → FAIL; wire hook; PASS.
5. Failing component test: single-month period renders weekly trend (title "Weekly Trend" / `data-granularity="weekly"`) and week labels; multi-month renders monthly.
6. Run → FAIL; update `MonthlyTrendChart` to accept granularity + bucket data; PASS; full suite + build.
7. Commit `feat(dashboard): weekly trend for single-month view with dynamic period refresh`.

**Risks:** `strftime('%W')` week numbering and the HU locale week start — pick ISO-ish behavior and document it; ensure empty weeks render as 0 (like empty months do). Keep the x-axis label formatting readable for 4–5 weekly points.

---

## FR4 (Transactions) — Manual-add tagging (tag input in AddTransactionModal)

**Objective:** When adding a transaction manually, let the user add tags (in addition to the automatic `AddedManually` tag). The tag input is currently missing from the add view.

**Files (from recon):**
- Modify: `src/components/TransactionsPage.tsx` — `AddTransactionModalProps` (260-276), `AddTransactionModal` (281-448), `handleSubmit` (302), toggles→submit gap (432-434), call site (1418), and destructure `searchTags` into `TransactionsPage` scope.
- Modify: `src/hooks/useTransactions.ts` — `addManualTransaction` interface (73-81) + impl (358-391).
- Reuse: tag-search UX from `src/components/EditTransactionPage.tsx:264-280` + `src/hooks/useEditTransaction.ts:261-284` (consider extracting a shared tag-input component).
- Test: `tests/components/TransactionsPage.test.ts` (1050-1081 area), `tests/hooks/useTransactions.test.ts` (257 area).

**Design decisions (deep tier — multi-file):**
- Add OPTIONAL param `tagNames?: string[]` to `addManualTransaction` (keeps the sole call site non-breaking). After the `AddedManually` auto-tag loop, add+attach each user tag (dedupe against `AddedManually`).
- Modal gets `tagNames` + `tagInput` state and a tag input with suggestions (reuse EditTransaction search) OR, acceptable first cut, an enter/comma-separated free-text input rendering removable pills. Rule in brief: reuse the existing debounced search for consistency; extract a `TagInput` shared component only if it stays within scope.
- Thread `searchTags` from the hook into `TransactionsPage` and pass to the modal; keep layering (modal does not call repositories directly).

**Steps (TDD):**
1. Failing hook test: `addManualTransaction({...}, ["Groceries"])` persists both `AddedManually` and `Groceries` tags on the new txn.
2. Run → FAIL; extend hook; PASS.
3. Failing component test: Add modal renders a tag input (`add-txn-tag-input`), user adds a tag chip, submit persists it (spy on `onAdd` receiving `tagNames`).
4. Run → FAIL; add modal UI + wire call site; PASS; full suite + build.
5. Commit `feat(transactions): add tag input to manual add-transaction modal`.

**Risks:** Interface signature change — keep `tagNames` optional. Full search+debounce is significant UI; the free-text fallback is acceptable. Avoid duplicating EditTransaction logic verbatim (review rubric flags verbatim duplication) — extract if reused.

---

## FR5 (Transactions) — Export/import retains IsDeleted; re-import re-hides

**Objective:** CSV export must include previously-deleted rows (with `IsDeleted=1`) so that re-import restores their soft-deleted (hidden) state.

**Files (from recon):**
- Modify: `src/hooks/useTransactions.ts:399` — use `getAllTransactionsIncludingDeleted(db)` instead of `getAllTransactions(db)`; update JSDoc (85-88).
- Modify: `src/services/ImportService.ts` — `importParsedRow` (195-231): remove the `if (row.isDeleted) return "skipped"` guard (196); insert with `isDeleted: row.isDeleted` (replace hardcoded `false` at 218); after `addTransaction`, if `row.isDeleted` call `softDeleteTransaction(db, savedTx.id)`; still re-create tags regardless.
- Test: `tests/services/ImportService.test.ts` (lines 186 + 315 MUST flip from skip→import), add a round-trip test; `tests/hooks/useTransactions.test.ts` add export-includes-deleted test.

**Design decisions:** `EXPECTED_COLUMN_COUNT=10` already matches — no schema change. The two existing "skips IsDeleted=1" tests encode the OLD wrong behavior and must be rewritten to assert import-with-`isDeleted:true` (this is expected, not a regression — note it in the brief so the reviewer doesn't flag it).

**Steps (TDD):**
1. Rewrite the two skip tests to assert IsDeleted=1 rows are imported and soft-deleted; add a round-trip test (export after deleting one → re-import into fresh DB → that txn is hidden). Run → FAIL.
2. Change export source fn; remove import skip guard; thread `isDeleted` + `softDeleteTransaction`. Run → PASS.
3. Full suite + build.
4. Commit `fix(transactions): retain IsDeleted through export/import round-trip`.

**Risks:** Pre-fix export files (IsDeleted always 0) still import fine. Full-table scan on export slightly slower — acceptable. Ensure tags on a deleted-then-imported row don't resurrect visibility.

---

## FR6 (Transactions) — Auto-classify on Title + Description(minus numbers)

**Objective:** Previous-category inference currently matches Title ALONE; change it to match Title AND Description with numbers stripped from the Description, enabling granular classification of `Átutalás elküldve…`-type transfers.

**Files (from recon):**
- Modify: `src/data/TransactionRepository.ts` — add `findLastTransactionByTitleAndBody(db, title, body)` after line 435: `WHERE IsDeleted=0 AND NotificationTitle IS ? AND NotificationBody IS ? ORDER BY ReceivedAt DESC LIMIT 1`.
- Modify: `src/services/IngestionService.ts` — add null-safe `stripNumbers(body)` helper (e.g. `body.replace(/[\d.,]+/g,'').trim()`); after line 84, look up title+body (stripped) and PREFER it over the title-only match for tag propagation (step 5), falling back to title-only.
- Test: `tests/data/TransactionRepository.test.ts` (437-480 area — add sibling tests), `tests/services/IngestionService.test.ts` (248-382 area — add same-title/different-body case).

**Design decisions:** PREFER-then-FALLBACK, never replace (or previously title-tagged txns lose classification). Keep `stripNumbers` conservative. Handle null body (bind null to `IS ?`). Document the stripping on both insert-time comparison AND the stored comparison basis so matches are symmetric.

**Steps (TDD):**
1. Failing repo test for `findLastTransactionByTitleAndBody` (match on title+body, null-body handling). Run → FAIL; implement; PASS.
2. Failing ingestion test: two txns same title, different numeric body → classified distinctly; same title+same stripped body → inherit tags. Run → FAIL; add `stripNumbers` + prefer/fallback lookup; PASS.
3. Full suite + build.
4. Commit `feat(transactions): auto-classify on title and number-stripped description`.

**Risks:** Over-aggressive regex loses signal; HU example `Átutalás elküldve 15 000 Ft Kovács Jánosnak` → `Átutalás elküldve  Ft Kovács Jánosnak` still distinguishes recipients. Ensure the stripping is applied identically to the stored-side comparison (store normalized body or strip both sides at query time).

---

## FR7 (Transactions) — OS swipe-back from Edit Transaction

**Objective:** Allow stepping back from the Edit Transaction view using the OS back gesture (Android system back), plus a visible Back control.

**Files (from recon):**
- Add dependency: `@capacitor/app` (`npm install @capacitor/app`) — NOT currently in package.json.
- Modify: `src/components/EditTransactionPage.tsx` — in the content component, `useEffect` registering `App.addListener('backButton', () => navigate('/transactions'))`, removed on unmount; guard dynamic import with try/catch for jsdom; add a visible header Back button (`navigate(-1)`).
- Possibly: `android/app/src/main/java/.../MainActivity.java` — verify `BridgeActivity` back handling; only override `onBackPressed` if the webview history isn't popped (check Capacitor 8 docs).
- Test: `tests/components/EditTransactionPage.test.ts` (509 area) — `vi.mock('@capacitor/app')`, assert `addListener('backButton', …)` on mount and removal on unmount.

**Design decisions:** Scope the listener to the EditTransaction component (NOT global in App.tsx) to avoid intercepting back on other routes. Guard dynamic import for the test env. Consider a confirm-discard dialog for unsaved edits (rule: out of scope unless trivial; at minimum, navigate without data loss by relying on existing autosave/explicit-save semantics — verify current save model).

**Steps (TDD):**
1. `npm install @capacitor/app`.
2. Failing test: mounting EditTransactionPage registers a `backButton` listener (mocked); unmount removes it; a visible Back button navigates away. Run → FAIL.
3. Add the effect + Back button, guarded import. Run → PASS; full suite + build (verify `cap sync` not required for web tests).
4. Commit `feat(transactions): enable OS swipe-back from edit transaction view`.

**Risks:** `BridgeActivity` default may still `finish()`; may need a `MainActivity` override — verify on-device against Capacitor 8. Dynamic import must not break jsdom. Unsaved-edit loss on back — confirm current save semantics before deciding on a discard prompt.

---

## FR8 (Transactions) — Default/Exception tag switch (auto-learn opt-out)

**Objective:** Let the user mark a transaction's tags as a one-off **Exception** so they do NOT pollute the merchant's auto-learned default tags. A `Default ⇄ Exception` switch sits near the tags (on BOTH the Edit Transaction screen and the manual-add modal), defaulting to **Default** (happy path). The merchant's Default tag set is auto-learned from the user's most-frequent tags at that merchant; Default-mode transactions feed that learning, Exception-mode transactions are excluded from it. So the next transaction at the same merchant still auto-gets the Default tags even after an exception.

**Clarified semantics (authoritative — from the user):**
- Default is **auto-learned from most-frequent tags at the merchant**; Default mode re-learns (counts toward frequency), Exception mode is **excluded from learning**.
- Switching a transaction to Exception **clears the already auto-assigned Default tags** so the user starts the exception from scratch.
- The switch lives near the tag section on **both** Edit Transaction and the manual-add modal; it applies retroactively on Edit Transaction (an existing auto-tagged txn can be reclassified as an exception).
- Default is pre-selected.

**Data model change:** add a persisted boolean column `ExcludeFromAutoLearn` (a.k.a. "is exception") to `Transactions`.
- `src/models/Transaction.ts`: add `excludeFromAutoLearn: boolean` to the `Transaction` interface (after `isIncome`, line 36) and default it `false` in `createTransaction` (116-ish).
- `src/data/DatabaseService.ts`: the schema (`CREATE_TABLES_SQL`, 21-59) uses `CREATE TABLE IF NOT EXISTS` with NO versioned migration — so adding the column to the DDL only helps fresh DBs. Existing on-device DBs need an **idempotent `ALTER TABLE Transactions ADD COLUMN ExcludeFromAutoLearn INTEGER NOT NULL DEFAULT 0`**, guarded by a `PRAGMA table_info(Transactions)` check (or a try/catch swallowing the "duplicate column name" error) run in `initDatabase` after the CREATE block. Add the column to the CREATE DDL too (for fresh installs).
- `src/data/TransactionRepository.ts`: read/write the new column in the row<->model mapping (every `getAsObject`→Transaction mapping and every INSERT/UPDATE must include it); add a mutator `setTransactionException(db, id, isException: boolean)`.

**Auto-learning opt-out (the core behavioral change):**
- `src/data/TransactionRepository.ts` — the previous-tag lookups that feed auto-classification (`findLastTransactionByTitle` 418-434 and the FR6-added `findLastTransactionByTitleAndBody`) MUST add `AND ExcludeFromAutoLearn = 0` to their WHERE clauses so exception transactions never serve as the learning source.
- If a "most-frequent tags at merchant" frequency query is added by the New-Ideas Theme 2 (merchant-match), it must apply the same `ExcludeFromAutoLearn = 0` filter — note this cross-plan dependency.
- `src/services/IngestionService.ts` — no change to the prefer/fallback logic beyond the repo filter; new captures are always `Default` (false) initially.

**UI:**
- `src/components/EditTransactionPage.tsx` — add a `Default | Exception` segmented toggle near the tag section (reuse the existing `ToggleSwitch` component at `src/components/ToggleSwitch.tsx` if its semantics fit, else a two-button segmented control). Wire to `setTransactionException` + local state. When flipping Default→Exception, **clear the currently-assigned tags** (and persist the cleared set); flipping back to Default does NOT auto-restore (user re-tags or re-runs classification — rule: leave cleared, user decides).
- `src/components/TransactionsPage.tsx` `AddTransactionModal` (FR3 adds the tag input here) — add the same toggle near the tag input; default `Default`. In Exception mode the manually-added tags are stored with `excludeFromAutoLearn=true`.
- `data-testid`s: `tag-mode-toggle`, `tag-mode-default`, `tag-mode-exception`.

**Files:**
- `src/models/Transaction.ts`, `src/data/DatabaseService.ts`, `src/data/TransactionRepository.ts`, `src/services/IngestionService.ts`, `src/components/EditTransactionPage.tsx`, `src/components/TransactionsPage.tsx`, `src/hooks/useEditTransaction.ts` (expose exception state + setter), `src/hooks/useTransactions.ts` (manual-add passes the flag).
- Tests: `tests/models/models.test.ts`, `tests/data/TransactionRepository.test.ts` (column round-trip + the `ExcludeFromAutoLearn=0` filter on both lookups), `tests/services/IngestionService.test.ts` (an exception txn is NOT used as the auto-tag source for a later same-merchant txn), `tests/components/EditTransactionPage.test.ts` + `tests/components/TransactionsPage.test.ts` (toggle renders, defaults to Default, flipping to Exception clears tags), `tests/hooks/useEditTransaction.test.ts`, `tests/hooks/useTransactions.test.ts`, and a `DatabaseService` migration test (ALTER is idempotent; a pre-existing DB without the column gains it with default 0).

**Steps (TDD) — standard tier, but coordinate with FR6 (shared lookups):**
1. Failing migration test: opening a DB created from the OLD schema (no column) then running `initDatabase` adds `ExcludeFromAutoLearn` defaulting 0; running twice does not error. Run → FAIL.
2. Add column to CREATE DDL + idempotent ALTER guard. Run → PASS.
3. Failing repo test: Transaction maps the column both ways; `setTransactionException` flips it; `findLastTransactionByTitle(AndBody)` excludes rows where it is 1. Run → FAIL; implement; PASS.
4. Failing ingestion test: tag an exception txn at merchant M, then capture a new txn at M → it is NOT auto-tagged from the exception (falls through to the real default / untagged). Run → FAIL; add the repo filter; PASS.
5. Failing component tests: toggle on Edit + manual-add, defaults to Default, flipping to Exception clears assigned tags and persists the flag. Run → FAIL; implement UI + hook wiring; PASS.
6. Full suite + build.
7. Commit `feat(transactions): add Default/Exception tag switch excluding exceptions from auto-learning`.

**Risks:**
- **Migration is the highest risk**: `IF NOT EXISTS` won't add a column to an existing DB, and sql.js has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — guard with `PRAGMA table_info` or catch the duplicate-column error. A botched migration corrupts persisted user data. Test against a seeded old-schema fixture.
- **Cross-plan dependency with FR6 and New-Ideas Theme 2**: the `ExcludeFromAutoLearn = 0` filter must be applied to EVERY previous-tag/frequency lookup, or exceptions leak into learning. Sequence FR8 AFTER FR6 so both lookups exist to be filtered; if the New-Ideas merchant-match frequency query lands later, carry a note to add the same filter.
- **Clear-on-exception**: ensure clearing persists (don't just clear local UI state) and that flipping back to Default has well-defined behavior (ruling: stays cleared; no silent re-tag).
- Keep the toggle visually consistent with the dark theme and existing `ToggleSwitch`.

---

## Execution order & final review

Suggested order: FR5 (isolated, high-value), FR6 (isolated), FR8 (depends on FR6's lookups — do right after FR6), FR2 (isolated UI), FR1 (period-model change — do before FR3), FR3 (depends on FR1's `lastMonth`), FR4 (multi-file, deep tier), FR7 (adds dependency). FR1 and FR3 share the period model and the Dashboard trend — sequence FR1 → FR3 and watch for the shared `useDashboard`/`DashboardRepository` interface in review. FR8 reuses FR3's and FR4's tag UI surfaces (manual-add modal, edit view) — if FR8 runs before FR4, add the toggle beside whatever tag input exists and let FR4 integrate.

After all tasks: whole-branch review on the **deep** tier, then `superpowers:finishing-a-development-branch`. Do NOT merge or push without explicit user consent.

