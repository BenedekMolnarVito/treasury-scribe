#!/usr/bin/env python3
"""
harness.py — deterministic behavioral smoke-test runner for Treasury Scribe.

Design contract (see .hermes/skills/treasury-smoke-test/SKILL.md):
  * CODE owns the flow: fixed navigation + hard assertions (testids, url, counts).
  * JEV (TypeSafe System One) is consulted ONLY for semantic yes/no assertions,
    ALL batched into ONE request per scenario. Never for planning or text.
  * Scenarios are declarative data in scenarios.yaml -> easy to extend/maintain.
  * Non-UI paths (file round-trips, notification ingestion) shell out to vitest.
  * Deterministic + reproducible: same seed data, same steps, thresholds in code.

Usage:
    python3 harness.py                 # run all scenarios, write report
    python3 harness.py --fresh         # clearState + reseed before UI scenarios
    python3 harness.py --only FR1,FR3  # run a subset (id prefix match)
    python3 harness.py --no-vitest     # skip the shelled-out Node suites
    python3 harness.py --rebuild       # rebuild+reinstall the APK first

Exit code 0 iff every selected scenario PASSED.
"""
import argparse, json, os, subprocess, sys, time
import yaml
import cdp
import jev

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out")
SCENARIOS = os.path.join(HERE, "scenarios.yaml")
ENV_SH = os.path.join(HERE, "android-env.sh")
os.makedirs(OUT, exist_ok=True)


def log(msg):
    print(msg, flush=True)


# --- navigation executor (deterministic) ------------------------------------
def run_nav(steps, default_sleep):
    for step in steps or []:
        if step == "launch":
            cdp.launch(); time.sleep(default_sleep)
        elif step == "dismiss_perms":
            for _ in range(3):
                cdp.press_key("KEYCODE_BACK"); time.sleep(1)
        elif isinstance(step, dict):
            (op, arg), = step.items()
            if op == "sleep":
                time.sleep(float(arg))
            elif op == "tap_text":
                cdp.tap_text(arg)
            elif op == "tap_testid":
                cdp.tap_testid(arg)
            elif op == "press_key":
                cdp.press_key(arg)
            elif op == "set_input":
                cdp.set_input(arg["field"], str(arg["value"]))
            else:
                raise ValueError(f"unknown nav op: {op}")
        else:
            raise ValueError(f"unknown nav step: {step!r}")


# --- hard code assertions (no model) ----------------------------------------
def run_code_asserts(spec, dom):
    """Return (ok: bool, failures: list[str]). Testid checks query the LIVE DOM
    (document.querySelector) rather than the distilled snapshot, because the
    distiller only surfaces testids on interactive/leaf elements and skips
    container testids like tag-filter / tag-mode-toggle."""
    fails = []
    if not spec:
        return True, fails
    url = dom["url"]
    texts = {e["text"] for e in dom["els"] if e["text"]}
    if "url_endswith" in spec and not url.rstrip("/").endswith(spec["url_endswith"].rstrip("/")):
        fails.append(f"url {url!r} !endswith {spec['url_endswith']!r}")
    if "url_contains" in spec and spec["url_contains"] not in url:
        fails.append(f"url {url!r} !contains {spec['url_contains']!r}")
    for t in spec.get("testid_present", []):
        if not cdp.eval_js("(()=>!!document.querySelector('[data-testid=\"' + %s + '\"]'))()" % json.dumps(t)):
            fails.append(f"testid missing: {t}")
    for t in spec.get("testid_absent", []):
        if cdp.eval_js("(()=>!!document.querySelector('[data-testid=\"' + %s + '\"]'))()" % json.dumps(t)):
            fails.append(f"testid should be absent: {t}")
    for t in spec.get("text_present", []):
        if not any(t == x or t in x for x in texts):
            fails.append(f"text missing: {t!r}")
    if "min_interactive" in spec:
        n = sum(1 for e in dom["els"] if e["kind"] == "interactive")
        if n < spec["min_interactive"]:
            fails.append(f"interactive {n} < {spec['min_interactive']}")
    if "js" in spec:
        got = cdp.eval_js(spec["js"]["expr"])
        want = spec["js"]["equals"]
        if got != want:
            fails.append(f"js assert got {got!r} != {want!r}")
    return (not fails), fails


# --- data seeding via the app's own Add-Transaction modal -------------------
def ensure_add_modal():
    for _ in range(3):
        if cdp.eval_js("(()=>!!document.querySelector('[data-testid=add-txn-tag-input]'))()"):
            return True
        cdp.tap_testid("nav-transactions"); time.sleep(1)
        cdp.tap_testid("fab-add"); time.sleep(1)
    return bool(cdp.eval_js("(()=>!!document.querySelector('[data-testid=add-txn-tag-input]'))()"))


def seed_transaction(tx):
    """Add one transaction via the modal. Verifies the modal closed (submit
    took) and retries once; returns True on success."""
    for attempt in range(2):
        if not ensure_add_modal():
            continue
        cdp.set_input("Title", tx["title"])
        cdp.set_input("Amount", str(tx["amount"]))
        if tx.get("desc"):
            cdp.set_input("Description", tx["desc"])
        cdp.set_input("Currency", tx.get("currency", "HUF"))
        tags = tx.get("tags", [])
        if tags:
            # comma-join all but last; submit auto-commits the trailing text (handleSubmit)
            val = ",".join(tags[:-1]) + ("," if len(tags) > 1 else "") + tags[-1]
            js = ("(()=>{const el=document.querySelector('[data-testid=add-txn-tag-input]');"
                  "Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,%s);"
                  "el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()" % json.dumps(val))
            cdp.eval_js(js)
            time.sleep(0.3)
        cdp.tap_text("Add Transaction")
        time.sleep(1.2)
        # modal closed => submit took
        if not cdp.eval_js("(()=>!!document.querySelector('[data-testid=add-txn-tag-input]'))()"):
            return True
    return False


def seed_all(seed_spec):
    log("  seeding transactions via Add modal...")
    cdp.tap_testid("nav-transactions"); time.sleep(1)
    n = 0
    for tx in seed_spec.get("transactions", []):
        if seed_transaction(tx):
            n += 1
    log(f"  seeded {n} transactions")
    return n


# --- vitest shell-out for non-UI paths --------------------------------------
def run_vitest(files):
    """Run the Node test suite for paths the emulator UI can't drive."""
    cmd = f'[ -f "{ENV_SH}" ] && source "{ENV_SH}"; npx vitest run ' + " ".join(files)
    r = subprocess.run(["bash", "-c", cmd], cwd=REPO, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-15:]
    passed = r.returncode == 0
    return passed, "\n".join(tail)


# --- APK rebuild (branch code may be newer than the installed APK) -----------
def rebuild_apk():
    log("  rebuilding APK (npm build -> cap sync -> gradle assembleDebug)...")
    cmd = (f'source "{ENV_SH}"; cd "{REPO}" && npm run build >/dev/null 2>&1 && '
           'npx cap sync android >/dev/null 2>&1 && '
           '(cd android && ./gradlew assembleDebug) >/dev/null 2>&1 && '
           'adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk')
    r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True)
    ok = "Success" in r.stdout or r.returncode == 0
    log("  rebuild " + ("OK" if ok else "FAILED:\n" + r.stdout[-500:] + r.stderr[-500:]))
    return ok


# --- scenario executor ------------------------------------------------------
def run_ui_scenario(sc, threshold, default_sleep, key):
    run_nav(sc.get("nav"), default_sleep)
    dom = cdp.extract_dom()
    # dump DOM for post-hoc inspection
    with open(os.path.join(OUT, f"{sc['id']}_dom.json"), "w") as f:
        json.dump(dom, f, indent=2)
    code_ok, code_fails = run_code_asserts(sc.get("code_assert"), dom)
    jev_results, jev_fails = {}, []
    asserts = sc.get("jev_assert") or []
    if asserts:
        state = {"screen": {"title": dom["title"], "url": dom["url"],
                            "elements": [{"kind": e["kind"], "text": e["text"],
                                          "testid": e.get("testid")} for e in dom["els"]]}}
        nouls = jev.batch_nouls(state, asserts, key)
        for a in asserts:
            v = nouls.get(a["id"], 0.0)
            jev_results[a["id"]] = v
            if v < threshold:
                jev_fails.append(f"{a['id']}={v:.2f}<{threshold}")
    verdict = "PASS" if (code_ok and not jev_fails) else "FAIL"
    return {"id": sc["id"], "feature": sc.get("feature", ""), "kind": "ui",
            "verdict": verdict, "url": dom["url"],
            "code_fails": code_fails, "jev": jev_results, "jev_fails": jev_fails}


def run_vitest_scenario(sc):
    passed, tail = run_vitest(sc["vitest_files"])
    return {"id": sc["id"], "feature": sc.get("feature", ""), "kind": "vitest",
            "verdict": "PASS" if passed else "FAIL",
            "vitest_files": sc["vitest_files"], "output_tail": tail}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="clearState + reseed before UI scenarios")
    ap.add_argument("--only", default="", help="comma-separated id prefixes to run")
    ap.add_argument("--no-vitest", action="store_true")
    ap.add_argument("--no-seed", action="store_true", help="skip seeding (assume data present)")
    ap.add_argument("--rebuild", action="store_true", help="rebuild+reinstall APK first")
    args = ap.parse_args()

    spec = yaml.safe_load(open(SCENARIOS))
    settings = spec.get("settings", {})
    threshold = float(settings.get("jev_pass_threshold", 0.8))
    default_sleep = float(settings.get("default_sleep", 1.3))

    only = [p.strip() for p in args.only.split(",") if p.strip()]
    def selected(sc):
        return (not only) or any(sc["id"].startswith(p) or sc["id"] == p for p in only)

    scenarios = [s for s in spec["scenarios"] if selected(s)]
    ui_scenarios = [s for s in scenarios if s.get("kind") != "vitest"]
    vitest_scenarios = [s for s in scenarios if s.get("kind") == "vitest"]

    if args.rebuild:
        if not rebuild_apk():
            log("ABORT: APK rebuild failed"); return 2

    key = None
    if ui_scenarios:
        if not cdp.device_online():
            log("ABORT: no booted emulator/device (adb sys.boot_completed != 1)"); return 2
        key = jev.load_key()
        if len(key) < 20:
            log("ABORT: TYPESAFE_API_KEY not loaded"); return 2
        if args.fresh:
            log("  clearing app state...")
            cdp.adb(f"adb shell pm clear {cdp.APP_ID} >/dev/null 2>&1")
        cdp.launch(); time.sleep(default_sleep)
        for _ in range(3):
            cdp.press_key("KEYCODE_BACK"); time.sleep(1)
        cdp.launch(); time.sleep(3)
        if not args.no_seed:
            seed_all(spec.get("seed", {}))

    results = []
    for sc in scenarios:
        log(f"\n=== {sc['id']} — {sc.get('feature','')} ===")
        try:
            if sc.get("kind") == "vitest":
                if args.no_vitest:
                    r = {"id": sc["id"], "feature": sc.get("feature",""), "kind": "vitest",
                         "verdict": "SKIPPED", "vitest_files": sc["vitest_files"]}
                else:
                    r = run_vitest_scenario(sc)
            else:
                r = run_ui_scenario(sc, threshold, default_sleep, key)
        except Exception as e:
            r = {"id": sc["id"], "feature": sc.get("feature",""), "verdict": "ERROR", "error": repr(e)}
        results.append(r)
        extra = ""
        if r.get("code_fails"): extra += f" code_fails={r['code_fails']}"
        if r.get("jev_fails"): extra += f" jev_fails={r['jev_fails']}"
        if r.get("error"): extra += f" error={r['error']}"
        log(f"[{r['verdict']:7}] {sc['id']}{extra}")

    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(results, f, indent=2)

    npass = sum(1 for r in results if r["verdict"] == "PASS")
    nrun = sum(1 for r in results if r["verdict"] in ("PASS", "FAIL", "ERROR"))
    log(f"\n{npass}/{nrun} scenarios PASSED")
    for r in results:
        log(f"  {r['verdict']:7} {r['id']}  {r.get('feature','')}")
    log(f"\nReport: {os.path.join(OUT, 'report.json')}")
    return 0 if npass == nrun else 1


if __name__ == "__main__":
    raise SystemExit(main())
