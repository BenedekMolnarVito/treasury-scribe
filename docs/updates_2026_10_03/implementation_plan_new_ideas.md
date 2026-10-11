# New Ideas — Implementation Plan

> **For Hermes:** Execute with `superpowers:subagent-driven-development`, task-by-task. This plan derives from `design_plan_new_ideas.md` (synthesis + judge). It covers the **MVP cut-line** (judge build order items 1–6); post-MVP themes are listed at the end as a backlog, not as executable tasks yet. Work on a dedicated branch. Do NOT begin until the user triggers execution.

**Goal:** Deliver the MVP slice of the new-ideas design — on-device merchant identity, auto-tagging with confidence, frictionless gesture tagging, safe CSV reconciliation, onboarding, and thumb-zone ergonomics — for the treasury-scribe local-first finance app.

**Architecture:** React 18 + react-router-dom v6 + Capacitor 8 + sql.js 1.14; vitest + @testing-library/react. Real components in `src/components/`. All logic on-device/offline; nothing leaves the device. New services go under `src/services/`, new repositories under `src/data/`, new sql.js tables created via the existing migration path in `src/data/DatabaseService.ts` (verify the migration mechanism before adding tables).

**Tech Stack:** TypeScript, React, sql.js, Capacitor (`@capacitor/app` already added by Fixed-Requirements FR7; `@capacitor/local-notifications` present; Android notification deep-link for onboarding).

**Dependency note:** This plan assumes the Fixed Requirements plan is either merged or on the same branch — FR6 (Title+Description-minus-numbers classifier) is the base that Theme 2 extends; FR5 (`IsDeleted` export/import) is the base that Theme 6 extends; FR1 (period-pill carousel) must be coordinated with Theme 8 pill repositioning. If Fixed Requirements are NOT yet done, sequence them first.

---

## Global Constraints

- `npm run test` and `npm run build` MUST pass before any task completes. TDD: failing test first.
- Everything on-device; no network calls, no external model/service. Privacy: notification payloads (amounts, merchant names) are concise and never logged.
- Follow existing style (inline `STYLE` objects, `data-testid`, dark theme). No drive-by refactors.
- New sql.js tables use the existing migration mechanism; never hand-mutate the schema outside it.
- Conventional Commits per task. Do NOT commit planning docs unless asked. Do NOT merge/push without explicit user consent.
- Apply the judge's YAGNI rulings: NO TF-IDF index, NO generic Command/UndoManager (use last-action snapshot), NO symmetric-pair transfer detection, NO confetti, NO Spending-Pulse animation in MVP.

## Subagent routing (auto-discovered by task shape)

Resolve concrete model ids from `config.yaml` `model.aliases`:
- **quick** (haiku): pure-function/algorithm tasks with a complete spec and heavy unit tests (Jaro-Winkler util, stripNumbers, dedup guard) → M1-T2, M2-T1.
- **standard** (sonnet): scoped single/two-file service+repository+UI wiring with clear acceptance → most tasks.
- **deep** (opus): multi-file UI coordination or design judgment (gesture layer + undo + inline sheet integration; confidence-UX calibration) → M4 (gesture/undo), M5 (confidence), and the FINAL whole-branch review.

Reviewers scale to diff size (standard default; deep for M4/M5 diffs). Always specify the model explicitly. Batch same-shape mechanical tasks into one dispatch.

---

## Milestone 1 — First-Run Onboarding & Empty States (Theme 7) [FIRST; no deps]

### M1-T1: Dashboard empty-state onboarding
**Objective:** When the DB has zero transactions, the Dashboard shows a 2-step onboarding instead of empty cards.
**Files:** Modify `src/components/DashboardPage.tsx` (empty-state branch); add `src/components/OnboardingEmptyState.tsx`. Test `tests/components/DashboardPage.test.ts`, new `tests/components/OnboardingEmptyState.test.ts`.
**Design:** Step 1 = "Grant notification access" CTA that deep-links to Android notification settings (reuse `NotificationListener.openNotificationAccessSettings` from `src/plugins/NotificationListenerPlugin.ts`). Step 2 (after access granted) = a STATIC illustrated mock-transaction card (not a live component). Deferred permission — never request on cold start.
**Steps (TDD):** failing test (zero-txn Dashboard renders `onboarding-step-1` with a grant CTA) → implement → PASS → add granted-state test → PASS → suite+build → commit `feat(onboarding): dashboard first-run empty state`.
**Risks:** keep the mock static to avoid coupling to the live card UI; verify the "has data" signal (transaction count) is cheap to compute.

### M1-T2: Transactions ghost-card empty state
**Objective:** Transactions list with zero rows shows a ghost card mimicking a real row.
**Files:** Modify `src/components/TransactionsPage.tsx` (empty branch). Test `tests/components/TransactionsPage.test.ts`.
**Steps (TDD):** failing test (`transactions-empty-ghost` present when no rows) → implement → PASS → suite+build → commit `feat(onboarding): transactions ghost-card empty state`.
**Risk:** don't show the ghost while loading (distinguish loading vs empty).

---

## Milestone 2 — Merchant Identity & Data-Quality Foundation (Theme 1) [TRUE ROOT]

### M2-T1: Jaro-Winkler util + stripNumbers + canonicalization (pure functions)
**Objective:** Pure, heavily-tested string utilities underpinning everything downstream.
**Files:** Create `src/services/merchantNormalizer.ts` (`jaroWinkler(a,b): number`, `stripNoise(raw): string` removing digits/punctuation/known suffixes like Kft/Zrt/POS/terminal codes, `canonicalize(raw): string`). Test `tests/services/merchantNormalizer.test.ts`.
**Design (quick tier — complete spec, pure fns):** Jaro-Winkler standard algorithm; `stripNoise` conservative (don't over-strip). **Add a minimum-length guard**: never fuzzy-match canonical names shorter than 4 chars (prevents 'OTP'/'OTB' collisions) — below the guard, require exact match.
**Steps (TDD):** failing tests (JW similarity on known pairs incl. HU diacritics; stripNoise removes trailing POS/terminal codes and amounts; min-length guard forces exact match) → implement → PASS → commit `feat(merchant): add Jaro-Winkler normalizer with min-length guard`.

### M2-T2: `merchants` canonical table + repository
**Objective:** Persist canonical merchants and map raw titles to them.
**Files:** Add migration for `merchants` table (via `DatabaseService.ts` mechanism — verify first); create `src/data/MerchantRepository.ts` (`findCanonical(db, rawTitle): Merchant|null` using min-length-guarded JW≥0.88; `upsertCanonical(db, canonicalName): id`; `inheritedTags(db, merchantId): Tag[]`). Test `tests/data/MerchantRepository.test.ts`.
**Steps (TDD):** failing repo tests (new raw title → no canonical; after upsert → JW match returns it; inheritedTags returns tags of prior txns for that merchant) → implement → PASS → suite+build → commit `feat(merchant): canonical merchants table and repository`.
**Risk:** migration must be idempotent and not corrupt existing DBs; test against a seeded fixture DB.

### M2-T3: Notification double-capture deduplicator
**Objective:** Suppress duplicate captures from the notification listener and (later) CSV import.
**Files:** Modify `src/services/IngestionService.ts` (pre-insert guard); add `dedupe_log` table + counter query; surface count where Settings lives (or Dashboard if no Settings screen — verify). Test `tests/services/IngestionService.test.ts`.
**Design:** before insert, query last 60s for identical (amount, currency, canonical); if found, discard and log. Reuse `canonicalize` from M2-T1.
**Steps (TDD):** failing test (two identical notifications within 60s → one row + one dedupe_log entry; outside 60s → two rows) → implement → PASS → suite+build → commit `feat(merchant): suppress duplicate notification captures`.
**Risk:** the ±60s window could collapse legitimate rapid split payments at one vendor — document and keep the window tight; make it a named constant.

### M2-T4: Revolut parser v2 (declarative pattern table) + needs-review queue
**Objective:** Robust parsing of card/ATM/topup/P2P/FX notifications in HU+EN; unparsed → needs-review.
**Files:** Refactor the existing parser in `src/services/NotificationService.ts` / `RevolutImportService.ts` (verify which owns parsing) to a declarative `parserPatterns` table; add a `needs-review` flag/query and a Dashboard badge. Test `tests/services/NotificationService.test.ts`.
**Design (standard tier — multi-pattern judgment):** ordered `{regex, fieldMap, txnType}` array; fall-through sets needs-review. Include HU patterns ('Kaptál…', 'Elküldtél…', 'Átutalás…').
**Steps (TDD):** failing tests (each pattern parses to correct fields; unknown text → needs-review) → implement → PASS → suite+build → commit `feat(merchant): declarative Revolut parser v2 with needs-review queue`.
**Risk:** don't regress existing parse cases — port every current test pattern first.

### M2-T5: Vendor Merge & Tag Backfill Wizard
**Objective:** Bulk-merge canonical variants and backfill tags.
**Files:** Create `src/services/hygieneService.ts`; a Settings "Data Hygiene" screen/section. Test `tests/services/hygieneService.test.ts`.
**Design:** find canonical names with JW>0.82 and divergent tags/variants; grouped merge-candidate list; on confirm rename variants, backfill tags onto untagged history, update stats — **atomic sql.js transaction**.
**Steps (TDD):** failing test (two near-duplicate canonicals → merge candidate; confirm → single canonical + backfilled tags, rollback-safe) → implement → PASS → suite+build → commit `feat(merchant): vendor merge and tag backfill wizard`.
**Risk:** atomicity — wrap in a transaction; test rollback on failure.

---

## Milestone 3 — CSV Import Reconciliation (Theme 6) [after M2]

### M3-T1: Reconciling CSV import
**Objective:** CSV import merges with captured data instead of duplicating; never resurrects soft-deleted; retains user tags.
**Files:** Modify `src/services/ImportService.ts` (reconciliation loop); reuse `canonicalize` (M2-T1) + `dedupe_log` (M2-T3); add an import-summary modal in `src/components/TransactionsPage.tsx`. Test `tests/services/ImportService.test.ts`.
**Design:** per CSV row match (amount, canonical, date±1d): if matched → merge ONLY richer/empty fields with a documented **field-precedence spec** (user edits win over CSV; CSV fills blanks); if the match is soft-deleted → leave deleted; retain user tags always; insert only unmatched rows. Show summary: "X new, Y merged, Z skipped (deleted), W duplicates suppressed."
**Depends on:** FR5 (`IsDeleted` export/import) must be in place — this is the merge/reconcile delta on top of it.
**Steps (TDD):** failing tests (duplicate CSV row → merged not inserted; soft-deleted match → not resurrected; user-tagged match → tags retained, not overwritten; unmatched → inserted; summary counts correct) → implement → PASS → suite+build → commit `feat(import): reconciling CSV import with soft-delete and tag preservation`.
**Risk:** field-precedence must be explicit or user edits get silently overwritten — encode it as a documented function and test both directions.

---

## Milestone 4 — Frictionless Tagging Interactions (Theme 3, simplified) [deep tier]

### M4-T1: Lightweight last-action undo (NOT a command bus)
**Objective:** One reversible-action primitive + a 5s undo toast.
**Files:** Create `src/hooks/useLastActionUndo.ts` (capture previous row state, expose `undo()`); a global `UndoToast` overlay. Test `tests/hooks/useLastActionUndo.test.ts`.
**Design (judge ruling):** store the previous DB row snapshot for the LAST mutating action only; one undo hook; one 5s countdown toast. NO generic Command registry, NO last-3 stack.
**Steps (TDD):** failing test (mutate → snapshot stored → undo restores previous state; after 5s commit, undo is a no-op) → implement → PASS → commit `feat(tagging): lightweight last-action undo with toast`.

### M4-T2: Swipe-to-Tag quick action
**Objective:** Right-swipe a txn row → top-3 recency×frequency tags, one tap applies, auto-advance; left-swipe → soft-delete + mark-income.
**Files:** Add `src/components/SwipeableRow.tsx`; integrate into the Transactions list row in `src/components/TransactionsPage.tsx`; tag-frequency query (recency×frequency) in `src/data/TagRepository.ts` or `TransactionRepository.ts`. Reuse M4-T1 undo. Test `tests/components/TransactionsPage.test.ts`, repository test for the frequency query.
**Steps (TDD):** failing tests (right-swipe reveals top-3 tags; tap applies + undo toast appears; left-swipe soft-deletes with undo) → implement → PASS → suite+build → commit `feat(tagging): swipe-to-tag quick action`.
**Risk:** auto-advance is a UX gamble — gate it behind validation; ensure edge-origin swipe doesn't fight the OS back gesture (coordinate with FR7).

### M4-T3: Inline tag editor bottom sheet
**Objective:** Long-press/double-tap a row → bottom sheet with chips + search + 5 vendor-based suggestions, autosave + undo.
**Files:** Add `src/components/InlineTagSheet.tsx`; reuse the EditTransaction tag-search (`useEditTransaction.ts:261-284`) — extract a shared `TagInput` ONLY if it stays in scope (avoid verbatim duplication, flagged by review rubric). Reuse M4-T1 undo + M5 suggestions once available. Test `tests/components/InlineTagSheet.test.ts`.
**Steps (TDD):** failing test (long-press opens sheet; add/remove chip autosaves; undo toast) → implement → PASS → suite+build → commit `feat(tagging): inline tag editor bottom sheet`.

### M4-T4: Progressive tag-cloud frequency ranking + vendor-adaptive suggestions
**Objective:** The NEW part of A7 only (the smaller-cloud-with-show-more shell is FR2).
**Files:** Modify the tag-cloud component(s) to sort by period usage frequency and, in triage/inline contexts, bias suggestions to the current vendor. Test the relevant component tests.
**Steps (TDD):** failing test (cloud ordered by frequency desc; vendor context reorders suggestions) → implement → PASS → suite+build → commit `feat(tagging): frequency-ranked, vendor-adaptive tag suggestions`.
**Risk:** coordinate with FR2 so the show-more shell and the frequency sort compose cleanly.

---

## Milestone 5 — Auto-Classification & Confidence UX (Theme 2, scoped) [deep tier]

### M5-T1: Merchant-match tag inheritance (extends FR6)
**Objective:** On insert, inherit tags from the canonical merchant's prior transactions. NO TF-IDF index (judge YAGNI ruling).
**Files:** Modify `src/services/IngestionService.ts` to call `MerchantRepository.inheritedTags` (M2-T2) and apply them with a computed confidence; this layers on top of FR6's Title+Description-minus-numbers match. Test `tests/services/IngestionService.test.ts`.
**Design:** confidence = count of prior same-tag matches for the canonical merchant. Prefer merchant-match; fall back to FR6's title+body match. Confirmed tags feed back by virtue of being stored (no separate index).
**Steps (TDD):** failing test (new txn at known merchant inherits its dominant tags with a confidence count; new merchant → no inheritance, grey confidence) → implement → PASS → suite+build → commit `feat(classify): merchant-match tag inheritance with confidence`.

### M5-T2: Confidence indicator on tag chips
**Objective:** Visual confidence signal + provenance tooltip.
**Files:** Modify the tag-chip component (Transactions list / EditTransaction) to render a dot: green (≥5 prior matches), yellow (2–4), grey/pulsing (new); tap → tooltip "Tagged Food because you tagged Aldi this way 12×". Test the relevant component tests.
**Steps (TDD):** failing test (chip shows correct dot color per confidence; tooltip text) → implement → PASS → suite+build → commit `feat(classify): confidence indicator on tag chips`.
**Risk:** confidence must be calibrated — miscalibrated dots erode trust. Keep the thresholds the same as M5-T1's count semantics.

### M5-T3: Smart Transfer Detector (keyword + IBAN only; NO symmetric-pair)
**Objective:** Classify transfers using HU/EN keywords + own-account IBANs.
**Files:** Modify the parser/ingestion path; add own-account IBANs/names config in Settings. Test `tests/services/IngestionService.test.ts`.
**Design:** keyword rules ('Átutalás','küldve','transfer','sent to'); own-account match → Internal Transfer + `IsIncome`/expense neutralized (verify the model's transfer semantics); unknown counterparty → Peer Transfer + one-tap Split prompt. **Drop symmetric-pair detection** (judge ruling).
**Steps (TDD):** failing test (own-account transfer → Internal Transfer, excluded from expense totals; peer transfer → Peer Transfer + split prompt flag) → implement → PASS → suite+build → commit `feat(classify): keyword and IBAN transfer detection`.

---

## Milestone 6 — Ergonomics (Theme 8, partial: FAB + period pills) [standard]

### M6-T1: Bottom-right FAB + period pills to bottom of hero
**Objective:** Thumb-zone placement for the two highest-value controls.
**Files:** Modify `src/components/TransactionsPage.tsx` (FAB → bottom-right) and `src/components/DashboardPage.tsx` (period pills → bottom of hero). **Coordinate with FR1** (period-pill horizontal-scroll carousel) so repositioning + carousel land together. Test both component tests.
**Steps (TDD):** failing tests (FAB positioned bottom-right; period pills rendered below the hero summary) → implement → PASS → suite+build → commit `feat(ergonomics): thumb-zone FAB and period pills`.
**Risk:** regression-test every affected screen; don't break FR1's carousel scroll.

---

## Post-MVP backlog (NOT executable yet — design only)

Per the judge build order, these come after the MVP and after real-usage validation; they are listed for traceability, not as ready tasks:
- **Theme 4 — Untagged Triage Mode** (after M5 suggestion quality is validated; no confetti).
- **Theme 5a — 2-Second Hero** + **Theme 5d — Budget Envelopes** (first dashboard-intelligence slice).
- **Theme 5b — Recurring-Stream Detector** (after 2+ months of real data).
- **Theme 5c — Anomaly Alerter** (≥10-observation guard + per-merchant cool-down) + **Theme 5e — Digest** (3–5 templates).
- **Theme 2 — TF-IDF keyword index** (only if merchant-match proves insufficient after 3+ months).
- **Theme 8 remainder** (inline-sheet chip placement, Amount-first field order, edge-origin swipes) + **unified notification strategy** before any Theme 5 alert ships (notification-fatigue mitigation).

When promoting a backlog item, expand it into bite-sized TDD tasks following the same structure, add the model-tier routing, and re-run the design→judge check if its scope changed.

---

## Execution order & final review

Milestones run in number order (1→6); within a milestone, tasks run in order. M4 and M5 are inter-dependent (M4-T3 inline sheet consumes M5 suggestions; M5 confidence feeds M4 chips) — sequence M5-T1/T2 before M4-T3, or stub suggestions in M4-T3 and wire them when M5 lands (ruling to be recorded by the executing controller). After all MVP milestones: whole-branch review on the **deep** tier, then `superpowers:finishing-a-development-branch`. Do NOT merge or push without explicit user consent.

