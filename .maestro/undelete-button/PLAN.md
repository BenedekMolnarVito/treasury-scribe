# PLAN — Undelete button smoke suite

## Expected outcomes (derived from code)

- UD1: banner + button visible for soft-deleted txn.
  `EditTransactionPage.tsx:602` gates on `isDeleted`; `604` renders
  `deleted-banner` with text "This transaction is deleted" (`604-606`);
  `607-614` renders `btn-undelete` with `onClick={undelete}` (`609,611`).
  `isDeleted` set from DB on load: `useEditTransaction.ts:204`
  (`setIsDeleted(tx.isDeleted)`). Router serves any id at `/edit/:id`:
  `App.tsx:447`; `getTransactionById` has no IsDeleted filter (per handoff).
- UD2: active txn → gate `602` false → neither testid in DOM; `btn-save`
  always rendered `618-626`.
- UD3: click → `useEditTransaction.ts:245-252`: `undeleteTransaction(db,id)`
  (`249`, `UPDATE ... SET IsDeleted=0`, `TransactionRepository.ts:342`),
  `setIsDeleted(false)` (`250`, banner/button disappear), no navigate call
  (stays on `/edit/:id`). `onDatabaseChanged` → `App.tsx:152-153`
  → `persistDatabase` (localStorage base64). List membership:
  list query filters `WHERE t.IsDeleted = 0`
  (`TransactionRepository.ts:163`), so restored row reappears; deleted rows
  never render (`TransactionsPage.tsx:1548-1568` empty-state/list).
- UD4: idempotent — second click is no-op: `UPDATE ... WHERE Id=?` on
  `IsDeleted=0` row changes nothing (`TransactionRepository.ts:342`);
  `id===null` guard `useEditTransaction.ts:246-247`. Button already
  unmounted after first click so second click targets nothing.
- UD5: save path untouched by diff; banner must not appear for active txn
  (gate `602` false throughout).
- UD6: Back → `navigate("/transactions")` (`EditTransactionPage.tsx:666`,
  testid `edit-back-button` `663-665`).

## Seeding strategy (chosen)

Add-Transaction modal over CDP (`fab-add`, `TransactionsPage.tsx:1574`)
with native value setter + dispatched `input` event; then soft-delete the
seeded txn via CDP JS-eval of the repo `softDeleteTransaction` path.
Rationale: only in-app delete path is swipe-right + `window.confirm`
(`TransactionsPage.tsx:13,157-158`); adb swipes don't reliably trigger
React swipe handlers (skill pitfall). Navigate to deleted txn via CDP JS
eval to `/edit/:id` (no UI route reaches deleted rows — decided, separate CR).

## Reset strategy

Between scenarios: removeItem DATABASE_STORAGE_KEY in localStorage via CDP
JS eval + reload → fresh empty DB.

## UNSPECIFIEDs (do not invent — verify at harness-build time)

1. Exact `DATABASE_STORAGE_KEY` string (`src/data/DatabaseService.ts` const —
   read before running; used for reset).
2. Add-modal input selectors (title/amount/datetime testids/placeholders —
   only `fab-add`, `input-datetime`, `add-txn-tag-input` confirmed;
   `TransactionsPage.tsx:438-594` — enumerate at build time).
3. Whether the release bundle exposes `softDeleteTransaction` (or any repo
   fn) to `window` for JS-eval seeding; fallback = base64 fixture insert
   into the localStorage key (mirrors `loadPersistedDatabase`/
   `persistDatabase`, `DatabaseService.ts:151-174`).
4. `run-as` file-pull storage assert: UNSPECIFIED — DB lives in WebView
   localStorage (base64 via `persistDatabase`), no on-device SQLite file
   path derived; rely on list-membership assert (UD3) instead.
5. `window.confirm` dialog during any swipe fallback — headless CDP auto-
   dismiss behavior unverified; prefer JS-eval path so no dialog arises.

## Out of scope (by design)

Re-ingest re-soft-delete after dedup window (`findSoftDeletedMatch`,
`TransactionRepository.ts:482`) — no scenario asserts it.
