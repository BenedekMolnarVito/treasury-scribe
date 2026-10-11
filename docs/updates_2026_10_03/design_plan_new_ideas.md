# Treasury Scribe — New Ideas Design Plan

> Status: DESIGN ONLY — not approved for implementation. Produced by an autonomous brainstorm pipeline (2 explorers → synthesis → judge) on 2026-10-03. The companion implementation plan is `implementation_plan_new_ideas.md`. Do NOT implement without an explicit user trigger (per `change_reqs.md`).
>
> Pipeline provenance: Explorer A (UX friction) + Explorer B (automation/intelligence) → 21 raw ideas → Synthesis (8 themes, 3 foundational capabilities) → Judge (feasibility/usefulness/trade-off scoring, corrected build order, MVP cut-line). All ideas are on-device/offline and privacy-preserving; nothing leaves the device.

## Scope boundary vs Fixed Requirements

These are SEPARATE from the already-decided Fixed Requirements (see `implementation_plan_fixed_requirements.md`). The following are Fixed Requirements and are NOT re-proposed here:
- Horizontal-scroll month tabs + "Last Month" tab; smaller tag cloud with show-more; weekly-vs-monthly trend (Dashboard).
- Export/import `IsDeleted` retention; auto-classification on Title+Description-minus-numbers; manual-add tagging; edit-view swipe-back (Transactions).

Where a new idea touches a Fixed Requirement, only the *delta* is new work (flagged per theme).

---

## Synthesis narrative

Treasury-Scribe's opportunity landscape clusters around a small number of foundational capabilities that unlock most downstream value. The single highest-leverage investment is a **canonical merchant identity layer** (Fuzzy Merchant Normalizer): Revolut notification text is noisy (card/FX suffixes, trailing numbers), and without normalization every downstream feature — tag inheritance, recurring detection, anomaly scoring, CSV reconciliation, vendor merge — operates on garbage identities. On top of that, **merchant-match tag inheritance with a visible confidence signal** removes most daily tagging friction while keeping the user in control. A **lightweight undo** (last-action snapshot, not a generic command bus) makes gesture-driven tagging safe enough to be fast. With these in place, the remaining work — triage flow, dashboard intelligence, onboarding, ergonomics — becomes low-risk incremental addition. The app's single-user, fully-offline nature means every idea is feasible on-device; the real axis of trade-off is implementation effort and false-positive risk versus marginal value for one power user.

## Foundational capabilities (judge-corrected)

1. **Fuzzy Merchant Normalizer** (TRUE ROOT — confirmed): canonical merchant identity underpinning dedup, recurring, anomaly, classification, CSV reconcile, vendor merge.
2. **Merchant-match tag inheritance + confidence indicator** (SCOPED DOWN from synthesis): the "Learned Auto-Classifier" foundation should be merchant-match only. **TF-IDF-lite keyword index is NOT a foundation** — it is a later optimization and a YAGNI violation for a single user's ~200–500 transaction corpus; recency×frequency merchant matching outperforms it without the index-maintenance surface.
3. **Lightweight last-action undo** (REPLACES the generic Command/UndoManager): a single-user, single-mutation-source app does not need a command registry. Store the previous row state, expose one undo hook, show one 5s toast. Identical UX, a fraction of the complexity.

## MVP cut-line

MVP = **Theme 7 (Onboarding)** + **Theme 1 (Merchant Identity)** + **Theme 6 (CSV Reconciliation)** + **Theme 3 simplified** (Swipe-to-Tag + Inline Tag Editor + per-action undo toast, NO command pattern) + **Theme 2 scoped** (merchant-match + confidence indicator, NO TF-IDF index) + **Theme 8 partial** (FAB + period pills).

This yields a fully functional auto-capturing, auto-tagging, dedup-safe, importable app with gesture tagging and thumb-zone ergonomics — everything a single user needs daily. Post-MVP: Theme 4 (triage), all of Theme 5 (dashboard intelligence), the full command pattern, the TF-IDF index, and remaining Theme 8 polish.

---

## Theme evaluation summary (judge scores)

| Theme | Feas. | Use. | Verdict |
|---|---|---|---|
| 1 — Merchant Identity & Data-Quality Foundation | 4 | 5 | Build-now (true root) |
| 2 — Auto-Classification & Confidence UX | 3 | 4 | Build-later (ship merchant-match + confidence first; defer TF-IDF) |
| 3 — Frictionless Tagging Interactions | 4 | 4 | Build-now (swipe + inline + simple undo); Reconsider full UndoManager |
| 4 — Untagged Triage Mode | 4 | 3 | Build-later (after suggestion quality validated) |
| 5 — Dashboard Intelligence & Proactive Alerts | 2 | 3 | Build-later (5a now, 5d next, 5b/5c/5e staged) |
| 6 — CSV Import Reconciliation | 5 | 4 | Build-now (after Theme 1) |
| 7 — First-Run Onboarding & Empty States | 5 | 4 | Build-now (activation; no deps) |
| 8 — Ergonomics & Thumb-Zone Polish | 5 | 3 | Build-now (FAB + pills); rest later |

---

## Theme details

### Theme 1 — Merchant Identity & Data-Quality Foundation  [Build-now · Feas 4 · Use 5]

Unified value: canonical merchant names make every downstream feature reliable instead of brittle per-string matching.

Capabilities:
- **Fuzzy Merchant Normalizer** (B1): strip numbers/punctuation/suffixes, Jaro-Winkler ≥0.88 against an incremental `merchants` table, inherit tags, confirm-once for new merchants.
- **Notification double-capture deduplicator** (B3): pre-insert guard on (amount, currency, canonical, ±60s); CSV dedupe on amount+merchant+date±1d; "X duplicates suppressed" counter in Settings.
- **Revolut parser v2** (B11): declarative ordered regex table covering card/ATM/topup/P2P/FX in HU+EN; unparsed → needs-review queue + Dashboard badge; versioned `parserPatterns.json`.
- **Vendor Merge & Tag Backfill Wizard** (B10): find Jaro-Winkler>0.82 canonical variants with divergent tags; grouped merge-candidate list; atomic backfill + stats update (Settings → Data Hygiene).

Judge justification: Jaro-Winkler is well-understood pure JS; all sql.js ops, no external deps. Highest-leverage data-quality investment — downstream features are garbage without it.

Trade-offs / risks: the 0.88 threshold is a magic number that misfires on short names ('OTP' vs 'OTB') — needs a minimum-length guard. Confirm-once UX must be frictionless or users accumulate junk. Versioned parser JSON adds schema-migration surface. The ±60s dedup window could falsely collapse legitimate split payments at the same vendor. Fixed-requirement overlap: none.

### Theme 2 — Intelligent Auto-Classification & Confidence UX  [Build-later · Feas 3 · Use 4]

Unified value: transactions arrive pre-tagged with a visible confidence signal, cutting manual tagging while keeping the user in control.

Capabilities:
- **Merchant-match tag inheritance** (from B9) — SHIP FIRST (low complexity, high value).
- **Confidence indicator on tag chips** (A5): green dot (≥5 prior matches), yellow (2–4), grey/pulsing (new); tap → provenance tooltip ("Tagged Food because you tagged Aldi this way 12×").
- **Smart Transfer Detector** (B4): HU/EN keyword rules ('Átutalás','küldve','transfer','sent to'), own-account IBANs in Settings → Internal Transfer + IsExpense=false; Peer Transfer + one-tap Split prompt. **Drop symmetric-pair detection** (hidden complexity spike — needs two-pass/deferred eval over async notification events; marginal value since the user knows their own transfers).
- **TF-IDF-lite keyword index** (B9) — DEFER. YAGNI for <1000 short Hungarian strings; revisit only if merchant-match proves insufficient after 3+ months.

Judge justification: merchant-match inheritance is trivial and handles 80–90% of cases; the keyword index adds non-trivial consistency state (invalidation on tag rename/delete/soft-delete/merge) and false-positives on common tokens ('Ft','HUF','átutalás'). Confidence dots are valuable only if calibrated — miscalibrated dots erode trust faster than no indicator.

Fixed-requirement overlap: the base Title+Description-minus-numbers classifier is a Fixed Requirement (FR6). Only the confidence-score output + (deferred) keyword-index feedback are new here. Do NOT re-implement the base classifier.

### Theme 3 — Frictionless Tagging Interactions  [Build-now (simplified) · Feas 4 · Use 4]

Unified value: any transaction taggable in under two taps without navigating away; mistakes instantly reversible.

Capabilities:
- **Swipe-to-Tag** (A1): right-swipe reveals top-3 recency×frequency tags, one tap applies, auto-advances to next untagged; left-swipe = soft-delete + mark-income. (Validate auto-advance with real data — wrong top-3 forces a back-navigation.)
- **Inline Tag Editor bottom sheet** (A4): long-press/double-tap opens sheet with removable chips + search + 5 vendor-based suggestions; autosave + undo toast, no Save button.
- **Lightweight per-action undo** (replaces A6's full Command pattern): store previous row state, one undo hook, one 5s countdown toast. RECONSIDER the generic UndoManager/last-3 command stack — over-engineered for a single mutation source.
- **Progressive tag cloud frequency ranking + vendor-adaptive suggestion** (A7 new part only; the smaller-cloud-with-show-more shell is Fixed Requirement FR2).

Judge justification: standard React/Capacitor patterns. The full Command pattern only pays off with concurrent mutation sources, which this app lacks. Fixed-requirement overlap: A7 base is FR2 — only frequency-ranking + vendor-adaptive suggestion are new.

### Theme 4 — Untagged Transaction Triage Mode  [Build-later · Feas 4 · Use 3]

Unified value: a focus mode to clear an untagged backlog quickly with swipe + suggestions.

Capability: full-screen card stack from the untagged badge, 3 suggestions/card, swipe accept/skip, progress counter, **(drop the confetti/celebration — gold-plating; a count-down indicator suffices)** (A2).

Judge justification: card-stack is achievable with CSS transforms + touch handlers. Catch-up feature, not daily-use; the untagged badge alone is sufficient MVP coverage. Depends on Themes 1/2/3 — poor suggestions make triage frustrating and train distrust. Build ONLY after Theme 2 suggestion quality is validated. Fixed-requirement overlap: none.

### Theme 5 — Dashboard Intelligence & Proactive Alerts  [Build-later (staged) · Feas 2 · Use 3]

Unified value: dashboard shifts from passive display to active co-pilot — anomalies, recurring patterns, digests, budget burn-rates — all computed on-device.

Capabilities (staged, in build order):
- **5a — 2-Second Hero** (A3): ONE primary number (net balance) + delta vs prior period (color) + one plain-language summary sentence; charts below the fold. TRIVIAL and high-value — do first.
- **5d — Budget Envelope + burn-rate nudges** (B7): per-tag monthly HUF budget in sql.js; notify at 75%/100%; daily burn-rate projection + "on track to overspend" badge; integer HUF math. Highest daily-value alert. (Risk: requires ongoing user maintenance of budgets or nudges become noise.)
- **5b — Recurring-Stream Detector** (B2): ≥3 occurrences at a fixed cadence (7/14/28/30/365d ±3d), rolling avg, notify on next expected date, price-change badge if amount deviates >15%. Build only after 2+ months of real data exist.
- **5c — Rolling Z-Score Anomaly Alerter** (B6): Welford's online mean/std per merchant/tag over last 20 txns; notify if |z|>2.5 and amount>2000 HUF; dismiss widens sigma. Build last; **add a minimum-observations guard (≥10) and a per-merchant cool-down** — with <6 priors σ is underestimated and alerts fire spuriously.
- **5e — Periodic Spending Digest** (B5): **3–5 HU/EN templates** (synthesis's 15 is over-specified) — top-tag spend Δ%, largest txn, recurring vs discretionary, net; month-end local notification + collapsible card. Lowest priority.
- **DROP: Spending Pulse micro-animation** (A10) — gold-plating (requestAnimationFrame loops, unmount cancellation) for negligible value in a data-first utility.

Judge justification: hero + pulse are trivial; the statistical detectors each need threshold tuning and local-notification scheduling, and with a small single-account corpus they fire spuriously or not at all. Notification fatigue is a real risk if anomaly + budget + digest fire independently — a unified notification strategy is required. The 5a–5e split is the correct mitigation. Fixed-requirement overlap: none.

### Theme 6 — CSV Import Reconciliation  [Build-now (after Theme 1) · Feas 5 · Use 4]

Unified value: importing a bank CSV merges intelligently — never duplicates, never resurrects soft-deleted rows, preserves user tags.

Capability: match CSV row on (amount, canonical, date±1d); merge richer fields only; do NOT resurrect soft-deleted; retain user tags; insert only unmatched; reconciliation summary modal (B8).

Judge justification: pure string/date matching in sql.js. Needs Theme 1's canonical identity for the match leg. **Needs a clear field-precedence spec** or it silently overwrites user edits with CSV data. Fixed-requirement overlap: the `IsDeleted` retention rule is Fixed Requirement FR5 — only the merge/reconcile logic (richer-field merge, tag retention, unmatched-only insert, summary) is new.

### Theme 7 — First-Run Onboarding & Empty States  [Build-now (first) · Feas 5 · Use 4]

Unified value: new users are guided to grant notification access and grasp the app's value immediately, preventing a silent activation failure.

Capabilities: Dashboard empty state 2-step (grant-notification CTA deep-linking to Android settings; then a **static** mock-transaction illustration); Transactions ghost card; deferred permission request (A8).

Judge justification: static UI + a deferred Capacitor permission request; no algorithmic complexity. Without it a fresh install shows a blank dashboard, the user never grants permission, and auto-capture never activates. Keep the mock as a static illustration (not a live component) to avoid coupling. Do NOT request permission on cold start. Fixed-requirement overlap: none.

### Theme 8 — Ergonomics & Thumb-Zone Polish  [Build-now (FAB + pills) · Feas 5 · Use 3]

Unified value: common actions reachable one-handed without repositioning.

Capabilities: bottom-right FAB (Add Transaction); period pills to bottom of hero; common tag chips in bottom half of the inline sheet; EditTransaction Amount-first field order; edge-origin swipes.

Judge justification: CSS/layout + a Capacitor gesture-config change; no new logic. FAB + period-pill repositioning are the highest-value items — ship now. The rest is a later polish pass. Risks: regression-test every affected screen; Amount-first is opinionated (may clash with a tag-first mental model); edge-origin swipes can conflict with Android system gestures — test on a real device. Fixed-requirement overlap: none (but coordinate with FR1's period-pill carousel so repositioning + horizontal-scroll land together).

---

## Over-engineering & privacy flags (judge)

- **TF-IDF keyword index (Theme 2)** — over-engineered for <1000 short strings; merchant-match recency×frequency matches it with zero index maintenance. YAGNI.
- **Full Command/UndoManager (Theme 3)** — single mutation source doesn't need a command registry; last-action snapshot + one undo hook + 5s toast suffices.
- **Symmetric-pair transfer detection (Theme 2)** — needs two-pass/deferred eval across async notification events; simplify to keyword+IBAN rules only.
- **Welford Z-score anomaly (Theme 5c)** — with <6 priors σ is underestimated → spurious alerts erode trust; require ≥10 observations + per-merchant cool-down.
- **Completion celebration/confetti (Theme 4)** — gold-plating; use a count-down progress indicator.
- **Spending Pulse micro-animation (Theme 5)** — gold-plating; drop.
- **15 digest templates (Theme 5e)** — over-specified; 3–5 cover the key cases.
- **Privacy** — all themes stay on-device; no exfiltration. One hygiene note (not code): the Capacitor local-notifications used for anomaly/recurring/budget alerts carry amounts + merchant names in the Android notification tray — document that payloads should be concise and not logged/cached beyond dismissal.

## Recommended build order (judge-corrected)

1. **Theme 7** — Onboarding (zero deps; governs activation of the core auto-capture value). Ship first.
2. **Theme 1** — Merchant Identity (true root; everything downstream depends on canonical identity).
3. **Theme 6** — CSV Reconciliation (trivial on top of Theme 1; closes the data-completeness loop).
4. **Theme 3 (simplified)** — Swipe-to-Tag + Inline Editor + per-action undo toast (defer the full command bus).
5. **Theme 2 (scoped)** — merchant-match inheritance + confidence indicator only (no TF-IDF yet); validate suggestion quality with real usage.
6. **Theme 8 (partial)** — FAB + period pills now; remaining polish deferred.
7. **Theme 4** — Untagged Triage Mode (only after Theme 2 suggestion quality is confirmed).
8. **Theme 5a + 5d** — 2-Second Hero (trivial) + Budget Envelopes (highest-value alert).
9. **Theme 5b** — Recurring-Stream Detector (after 2+ months of real data).
10. **Theme 5c + 5e** — Anomaly Alerter + Digest (lowest priority; only if 5b works and notification fatigue isn't already a problem).
11. **Theme 2 TF-IDF index** (deferred) — revisit only if merchant-match proves insufficient after 3+ months.

Items 1–6 (Theme 7, 1, 6, 3-simplified, 2-scoped, 8-partial) constitute the MVP cut-line above.
