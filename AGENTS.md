# AGENTS.md — Treasury Scribe (caveman mode)

> Caveman speech = few token, no glue word. Reader fill grammar. Signal only.
> Last sync: 2026-10-03, branch feat/2026-10-03-change-reqs-impl.

## WHAT REPO IS

Treasury Scribe = offline-first Android budget app. React 18 + TS 5 + Vite 7, Android via Capacitor 8. DB = sql.js (SQLite in WASM), on-device, zero network. Capture Revolut push notif → parse amount/currency/vendor → tag/edit/export. Reimpl of vito-budget-tracker (old .NET MAUI).

All business logic in TS → testable no Android. Kotlin plugin thin, only forward notif.

## TOOLCHAIN (not pytest!)

```
npm run test        # vitest run — ALL tests, baseline gate
npm run test:watch  # vitest watch, TDD red→green
npm run build       # vite build
npm run dev         # vite dev server
npx tsc --noEmit    # typecheck = de-facto lint (NO separate lint cmd)
npm run cap:sync    # web → android
npm run android:run # build → cap sync → gradle installDebug
```

Gate = `npm run test` exit 0 + `npm run build` ok + `npx tsc --noEmit` clean. State now: 23 files, 691 tests, all green.

## SPEC SOURCES (no SPECIFICATION.md exist)

- change_reqs.md — active fixed-requirement list (FR Dashboard + Transactions) + brainstorm/plan asks.
- docs/ARCHITECTURE.md — layers, schema, module duty, data-flow diagrams. Synced Oct 2026 to current code.
- README.md — feature overview + install/test/build + project structure. Synced Oct 2026.
- docs/BUSINESS_LOGIC.md — user flows + smart behaviors.
- .github/copilot-instructions.md — DETAILED repo-reality (commands, conventions, service signatures). Read FIRST for implementation detail. Authoritative on code conventions.
- docs/updates_2026_10_03/ — design plan + impl plans from brainstorm pipeline.

Spec silent → pick most maintainable, lowest cognitive load. Ambiguous → stop, resolve vs spec, no invent. Behavior not in spec = out of scope, flag not build.

## ARCHITECTURE (5 layer, strict duty)

```
Capacitor Plugin (Kotlin)    → listen Revolut notif, forward TS via event
  ↓
NotificationServiceCore (TS) → validate pkg, regex parse amount/currency, build Transaction
  ↓  (NotificationService.ts = thin re-export facade, logic in Core)
IngestionService (TS)        → 4 smart behavior FIXED order: dedup → persist → auto-soft-delete → auto-tag
  ↓
Repositories (TS)            → all SQLite, prepared stmt, eager JOIN, explicit cols, WHERE IsDeleted=0 default
  ↓
React hooks + components     → useTransactions / useEditTransaction / useDashboard own screen state; components = stateless render
```

Extra services: ImportService (app CSV/JSON bulk), RevolutImportService (Revolut own CSV, skip Átváltás FX, ±1day dedup), SplitTransactionService (split 1 txn → parts, parent soft-delete). DashboardRepository = analytics (summary/byTag/byMonth/byVendor/untagged), base filter IsDeleted=0 AND IsIncome=0 AND Amount NOT NULL.

Routes: `/`→Dashboard (home), `/transactions`→list, `/edit/:id`→edit, `/dashboard`→alias.

## KEY CONVENTION (full detail → copilot-instructions.md)

- Repo fn: `db: Database` FIRST param, inject in-memory DB in test. No singleton DB import.
- Query: prepared stmt `?` binds, no interpolation; JOIN eager, no N+1; explicit cols no `SELECT *`.
- Models src/models/ = interface + factory, factory set all default explicit. DB object → `withComputedProps()` re-attach parsedAmount/parsedCurrency getters.
- Test: fresh in-memory DB per test (beforeEach initDatabase, afterEach db.close). Import vitest fns explicit, NO globals. `make*` fixture factory, override only what test care. Capacitor mocked no-op via src/__mocks__.
- Naming: DB table/col PascalCase; TS var/fn camelCase; interface/type PascalCase; const UPPER_SNAKE.
- Styling inline React CSSProperties, dark theme #121212, no CSS framework.
- Currency parse 6 format priority, default HUF. Symbol map $→USD €→EUR £→GBP ¥→JPY ₹→INR ₽→RUB ₣→CHF ₩→KRW.

## GIT

- Branch feat/<goal-slug>, auto by orchestrator.
- Commit = Conventional: feat(<scope>): <imperative>.
- Never force-push. Never amend published. Never --no-verify.
- PR auto when all acceptance met.

## DEFINITION OF DONE

1. All acceptance criteria met.
2. `npm run test` exit 0 (all 691+ pass).
3. New behavior = new test, coverage ≥95% line+branch hold.
4. QA Judge verdict PASS.
5. SECURITY_AUDITOR no open ISSUE on changed code.
6. Quality score ≥ quality_threshold (OrchestratorConfig).
7. Committed, conventional message.
8. Scenarios autonomously made by Planner from DoD + acceptance.
9. Scenarios in suite + pass, QA Judge verify. Behavioral scenario = .maestro/ (Maestro flows + CDP+Jev smoke harness .maestro/smoke/), NOT scenarios.md.

## VERIFY EVIDENCE (not Android-Studio-only)

QA Judge evidence from REAL output: `npm run test` result, `npm run build` result, `npx tsc --noEmit`, OR behavioral smoke harness .maestro/smoke/ (CDP+Jev DOM dumps in out/*.json + report.json). On-device = Capacitor + adb logcat. No lazy evidence, no behavioral inconsistency accept. QA = guardian of DoD, check every flow.

## WORKFLOW (dynamic subagent — applicable today)

NO static roster. NO fixed cast of persistent agents. Work = parent spawn SUBAGENT on demand, each w/ dynamically specified task (goal + context + toolset), auto-discovered routing. Role is just a HAT the parent assigns per task, not a standing seat. Pipeline that built this repo = that pattern (see .superpowers/sdd/).

Routing (parent choose per task, auto-discover from task shape):
- novel idea / UX explore → spawn explorer, web search, interdisciplinary bridge, UX/UI stat.
- spec decompose → spawn planner, spec → ordered task list, balance tech+UX, DoD verifiable w/ primitive tool.
- knowledge gap → spawn researcher, credible source / official doc.
- implement task → spawn worker, 1 task scope, follow spec, self-check logic CAUSE specified behavior, contradiction → escalate to parent/planner.
- verify acceptance → spawn QA judge, REAL tool output, guardian of DoD.
- test fail → spawn debugger, root cause not symptom, drill log 1 level, check every var + I/O.
- quality pass → spawn refactorer, check regression, change only if REALLY needed.
- vuln scan (every Nth iter) → spawn security auditor, assume adversarial, hunt back door; found vuln → spawn researcher for known exploit, add to issue.

Model tier per task: deep = design/root-cause/ambiguous; standard = scoped impl/edit (default); quick = verify/fetch/categorize. Subagent resolve alias from config.

Dispatch rule (proven): big brief inline → stream timeout. Write brief/rubric to file in worktree, dispatch SHORT prompt "read <path>, authoritative". Subagent report/diff → file not inline.

Parallel (proven): group FILE-DISJOINT task clusters, each own git worktree+branch (npm ci per worktree), serial within cluster, parallel across, merge --no-ff = zero conflict.

Routing is parent judgement by task, no agent skip scope. Subagent isolated: knows nothing of parent convo → pass all needed context. External side effect (upload/write) = verify handle self, not trust self-report.

## TASK HATS (dynamic — spawn as needed, not a roster)

| Hat | Concern | Output |
|---|---|---|
| explorer | novel idea web search | plannable direction |
| planner | spec decomposition | ordered task list |
| researcher | knowledge gap | findings |
| worker | implementation | code change |
| qa judge | acceptance verify | VERDICT: PASS/FAIL |
| debugger | failure fix | FIX: SUCCESS/FAILED |
| refactorer | code quality | QUALITY_SCORE: <float> |
| security auditor | vuln scan | ISSUE: <text> per find |

## ANTI-PATTERN (any task)

- Gold-plating: build beyond spec.
- Assumption coding: guess requirement.
- Silent scope creep: refactor unrelated while bugfix.
- Skip test: impl without test.
- Cargo-cult: copy boilerplate not needed.
