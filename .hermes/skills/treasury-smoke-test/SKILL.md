---
name: treasury-smoke-test
description: "Deterministic on-device smoke test for Treasury Scribe."
version: 1.0.0
author: Benedek Molnar, Hermes Agent
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [testing, android, capacitor, webview, cdp, typesafe, jev, smoke, regression]
    related_skills: [android-webview-jev-testing, typesafe-ai]
---

# Treasury Scribe Behavioral Smoke Test

Deterministic, reproducible behavioral smoke test for the Treasury Scribe
Capacitor/Android app, driven over the Chrome DevTools Protocol (CDP) against a
real AVD emulator. Code owns the flow and all hard assertions; TypeSafe **Jev**
(System One) supplies only semantic yes/no judgments, batched one request per
screen. Non-UI paths (file round-trips, notification ingestion) shell out to the
project's `vitest` suites so one run covers every FR.

This is a project-scoped skill: the runnable harness lives in the repo at
`.maestro/smoke/` and travels with the code. Extend it by editing
`.maestro/smoke/scenarios.yaml` — no Python changes needed for new assertions.

## When to Use

- Verifying implemented features on a feature branch behave on-device (the
  recurring `/loop` smoke-test task).
- Regression-checking after a change to Dashboard or Transactions UI.
- Any time you need an objective, repeatable pass/fail across the app's features.
- Don't use for: pure unit logic (write a `vitest` test), or native-Android apps
  (this targets the Capacitor WebView DOM).

## Design Contract (do not violate)

1. **Code owns the flow.** Navigation is a fixed `nav` step list per scenario.
   Jev never decides what to tap and never chooses the next action.
2. **Jev is for semantic yes/no only**, never planning or text output. Each
   scenario's `jev_assert` list is sent as ONE batched request of Nouls over the
   captured DOM state (TypeSafe evaluates them in parallel; see
   `android-webview-jev-testing` and `typesafe-ai` skills). Batching keeps each
   scenario to a single fast, cheap API round-trip.
3. **Hard checks are deterministic code** (`code_assert`): testid presence (queried
   live via `document.querySelector`, not the distilled snapshot), URL, element
   counts, raw JS booleans. A scenario PASSES iff every `code_assert` passes AND
   every `jev_assert` noul >= threshold (default 0.8).
4. **Scenarios are declarative data** in `scenarios.yaml`. Adding/maintaining a
   test = editing YAML.
5. **Reproducible:** `--fresh` clears app state and reseeds fixed transactions
   through the app's own Add-Transaction modal before UI scenarios run.

## Prerequisites

- An AVD exists and is booted (`treasury_test` by default). Check:
  `terminal(command="source .maestro/smoke/android-env.sh && adb shell getprop sys.boot_completed")`
  must print `1`.
- A DEBUG APK of the CURRENT branch installed (debug builds expose CDP). The
  installed APK goes stale — rebuild when source is newer (see Procedure step 1).
- `TYPESAFE_API_KEY` exported in the shell (the harness also falls back to
  sourcing `~/.zshrc`). Never commit the key.
- Python deps: `pyyaml`, `websockets` (stdlib otherwise). Toolchain env in
  `.maestro/smoke/android-env.sh` (adb/gradle paths; override vars as needed).

## How to Run

Always source the env first, then invoke the harness through `terminal`:

```
terminal(command="cd .maestro/smoke && source android-env.sh && python3 harness.py --fresh",
         timeout=600)
```

Common invocations:

- `python3 harness.py --fresh` — clear state, reseed, run every scenario (UI + vitest).
- `python3 harness.py --fresh --no-vitest` — UI scenarios only (fast iteration).
- `python3 harness.py --only FR1,FR3` — run a subset by id prefix.
- `python3 harness.py --no-seed` — reuse existing on-device data (don't reseed).
- `python3 harness.py --rebuild` — rebuild+reinstall the APK first, then run.

Exit code 0 iff every selected non-skipped scenario PASSED. Per-scenario DOM
dumps and a machine-readable `report.json` land in `.maestro/smoke/out/`.

## Procedure

1. **Ensure the APK matches the branch.** Compare source mtimes to the installed
   APK; if any `src/**` file is newer, rebuild+reinstall:
   `terminal(command="source .maestro/smoke/android-env.sh && APK=android/app/build/outputs/apk/debug/app-debug.apk && find src -newer $APK | head")`.
   If output is non-empty, run `python3 harness.py --rebuild ...` (uses `./gradlew`,
   not the Windows `gradlew.bat` the npm `android:run` hardcodes).
2. **Confirm the emulator is booted** (Prerequisites check == 1). If not, boot it:
   `terminal(command="source .maestro/smoke/android-env.sh && emulator -avd treasury_test -no-snapshot-load", background=true)`.
3. **Run the suite** with `--fresh` for a clean, deterministic run (clears state,
   reseeds the fixture transactions, runs all scenarios).
4. **Read the summary** and `out/report.json`. Each failing scenario lists
   `code_fails` and/or `jev_fails` with the exact assertion. Open the matching
   `out/<id>_dom.json` to see the captured screen.
5. **Triage a failure:** is it an app regression or a scenario drift? Check the
   DOM dump's `testid`s and `url` against the scenario's expectations. If the app
   changed a testid, update the scenario; if the behavior broke, that's a real bug
   — record it with evidence (the dump + the failing assertion).

Completion criterion: every non-skipped scenario is PASS (exit 0), or each FAIL is
classified as app-bug (with evidence) vs scenario-drift (fixed in YAML).

## Extending (regression-friendly)

Add a scenario = append one item under `scenarios:` in `scenarios.yaml`:

- `id` (stable — keys the report), `feature` (human label).
- `nav`: ordered deterministic actions — `launch`, `dismiss_perms`,
  `{tap_testid: X}`, `{tap_text: "Label"}`, `{set_input: {field, value}}`,
  `{press_key: KEYCODE_BACK}`, `{sleep: N}`.
- `code_assert`: `url_endswith`/`url_contains`, `testid_present`/`testid_absent`
  (lists), `text_present` (list), `min_interactive`, `js: {expr, equals}`.
- `jev_assert`: list of `{id, question, true, false}` — ALL batched into one
  request. Pass if noul >= `settings.jev_pass_threshold`.
- For a non-UI path, use `kind: vitest` + `vitest_files: [...]`.

Prefer a hard `code_assert` (testid/url/count) over a `jev_assert` whenever the
check is exact — reserve Jev for genuinely semantic judgments ("is this a weekly
trend chart?"). Keep an **async-updating control's click as a `nav` step with a
settle `sleep`**, then assert in `code_assert` — never click and read in one `js`
expression (React re-renders after the tick, so the read sees stale DOM).

## Pitfalls

- **Distilled DOM omits container testids.** The snapshot only carries testids on
  interactive/leaf elements; container testids like `tag-filter` and
  `tag-mode-toggle` are missing from it. `code_assert.testid_present` therefore
  queries the LIVE DOM — don't reintroduce snapshot-based testid checks.
- **React updates are async.** Clicking a toggle and reading the result in the
  same `js` eval sees pre-render state. Split: click via `nav`, settle, then read.
- **Stale APK.** The installed APK does not auto-update with source; a green run
  against a stale APK is meaningless. Always verify/rebuild (Procedure step 1).
- **Seeding can glitch under modal timing.** `seed_transaction` verifies the modal
  closed and retries once; if a feature needs N tagged txns, confirm the seed count
  in the log (`seeded N transactions`).
- **WebView CDP socket PID changes** when the WebView respawns; `cdp.py`
  re-resolves and re-forwards on every call — do not cache the WS URL.
- **File round-trips and notification ingestion are not UI-drivable** (Capacitor
  Share/Filesystem + native picker; the listener only accepts its allow-listed
  source package). These stay `kind: vitest` — do not fake on-device results.
- **Maestro is not the DOM tool here.** `.maestro/smoke.yaml` is only for boot/
  launch; the WebView DOM is absent from the accessibility tree.

## Verification

- `python3 harness.py --fresh` exits 0 with every UI scenario PASS and the three
  `kind: vitest` scenarios PASS.
- `out/report.json` lists a verdict per scenario; `out/<id>_dom.json` shows the
  exact captured screen for any scenario you want to audit.
- Baseline (branch feat/2026-10-03-change-reqs-impl): 11 UI + 3 vitest = 14
  scenarios, all PASS; each UI scenario is a single batched Jev request.
