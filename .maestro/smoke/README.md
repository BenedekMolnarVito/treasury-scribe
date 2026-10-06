# Treasury Scribe — behavioral smoke test (`.maestro/smoke/`)

Deterministic, reproducible on-device smoke test. **Code owns the flow and all
hard assertions; TypeSafe Jev supplies only semantic yes/no judgments, batched
one request per screen.** Non-UI paths shell out to `vitest`.

Full guide: `.hermes/skills/treasury-smoke-test/SKILL.md`.

## Files
- `scenarios.yaml` — declarative scenarios (nav + code_assert + jev_assert, or
  `kind: vitest`). **Edit this to add/maintain tests — no Python changes needed.**
- `harness.py` — runner: nav executor, code-assert engine, batched-Jev caller,
  vitest shell-out, seeding, reporting.
- `cdp.py` — CDP DOM primitives (extract, tap, set_input, press_key, launch).
- `jev.py` — TypeSafe Jev client; `batch_nouls` sends many assertions in ONE request.
- `android-env.sh` — adb/gradle toolchain env (override vars for your machine).
- `out/` — per-run artifacts (`report.json`, `<id>_dom.json`); git-ignored.

## Run
```sh
source android-env.sh
python3 harness.py --fresh                 # clean run, all scenarios
python3 harness.py --fresh --no-vitest     # UI only, fast
python3 harness.py --only FR1,FR3          # subset by id prefix
python3 harness.py --rebuild --fresh       # rebuild+reinstall APK first
```
Requires: booted AVD, a debug APK of the current branch, `TYPESAFE_API_KEY` in env,
and `pip install pyyaml websockets`. Exit 0 iff every non-skipped scenario PASSED.
