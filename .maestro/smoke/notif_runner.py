#!/usr/bin/env python3
"""
notif_runner.py - deterministic notification-ingestion regression runner.

Drives the REAL NotificationListenerService path on an isolated emulator:
smoke-only poster APK (applicationId com.revolut.revolut) posts notifications,
the app ingests them, and rows are read back from the live WebView DOM over CDP.
No screenshots. Code owns navigation and every hard assertion; Jev (TypeSafe) is
only called when a scenario has a non-empty jev_assert list (batched, fail closed).

Scenarios: notif_scenarios.yaml (spec: plans/notif_group_summary_suite.md).
Verdicts: PASS / FAIL (app behaviour differs from oracle) / ERROR (harness or
precondition broke - NOT an app verdict) / BLOCKED (environment cannot exercise
the case, e.g. OS posted no autogroup summary) / NOT_RUN.

Usage:
  python notif_runner.py --validate            # schema check only, no device
  python notif_runner.py --list
  python notif_runner.py                       # all scenarios
  python notif_runner.py --only NG01,NG06      # id prefixes
  python notif_runner.py --no-vitest
Exit 0 iff every selected scenario PASSED (known_red scenarios count as failing).
"""
import argparse, asyncio, base64, json, os, re, shutil, subprocess, sys, time, uuid
import urllib.request

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out", "notif")
SCENARIOS = os.path.join(HERE, "notif_scenarios.yaml")

SERIAL_REQUIRED = "emulator-5554"
SERIAL = os.environ.get("ANDROID_SERIAL", SERIAL_REQUIRED)
APP = "com.treasuryscribe.app"
APP_ACTIVITY = f"{APP}/.MainActivity"
LISTENER = f"{APP}/{APP}.RevolutNotificationService"
POSTER = "com.revolut.revolut"
POSTER_OTHER = "com.treasury.smokeposter.other"
POSTER_CLASS = "com.revolut.revolut.Post"
CDP_PORT = int(os.environ.get("TS_CDP_PORT", "9333"))

NAV_STRING_OPS = {"reset_app", "clear_notifications", "launch"}
NAV_DICT_OPS = {"sleep", "tap_testid", "post_notification", "cancel_notification",
                "native_assert", "checkpoint", "restart_app", "await_rows"}
CODE_ASSERT_KEYS = {"url_endswith", "url_contains", "testid_present", "testid_absent",
                    "text_present", "row_count", "rows_equal", "no_empty_rows"}
SCENARIO_KEYS = {"id", "feature", "nav", "code_assert", "jev_assert", "timing_guard",
                 "known_red", "kind", "vitest_files", "hint"}


class HarnessError(Exception):
    """Harness/precondition failure -> ERROR verdict (not an app verdict)."""


class Blocked(Exception):
    """Environment cannot exercise the scenario -> BLOCKED verdict."""


class AssertFail(Exception):
    """App behaviour differs from oracle -> FAIL verdict."""


def log(msg):
    print(msg, flush=True)


# --------------------------------------------------------------------------- adb
def adb(*args, check=True, timeout=60):
    if SERIAL != SERIAL_REQUIRED:
        raise HarnessError(f"REFUSE: ANDROID_SERIAL={SERIAL!r}, only {SERIAL_REQUIRED} allowed")
    r = subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, timeout=timeout)
    out = r.stdout.decode("utf-8", "replace")
    if check and r.returncode != 0:
        raise HarnessError(f"adb {' '.join(args)} rc={r.returncode}: {r.stderr.decode('utf-8','replace')[:300]}")
    return out


def sh(cmd, check=False):
    return adb("shell", cmd, check=check)


def pkg_installed(pkg):
    return f"package:{pkg}" in sh(f"pm list packages {pkg}")


# --------------------------------------------------------------------------- CDP
def app_pid():
    return sh(f"pidof {APP}").strip().split(" ")[0]


def live_ws():
    pid = app_pid()
    if not pid:
        raise HarnessError("app process not running")
    unix = sh("cat /proc/net/unix")
    if f"webview_devtools_remote_{pid}" not in unix:
        raise HarnessError(f"no WebView devtools socket for app pid {pid} (debug APK?)")
    adb("forward", "--remove", f"tcp:{CDP_PORT}", check=False)
    adb("forward", f"tcp:{CDP_PORT}", f"localabstract:webview_devtools_remote_{pid}")
    with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=5) as r:
        pages = [t for t in json.load(r) if t.get("type") == "page"]
    if not pages:
        raise HarnessError("no CDP page target")
    return pages[0]["webSocketDebuggerUrl"]


async def _eval(expr):
    import websockets
    async with websockets.connect(live_ws(), max_size=16 * 1024 * 1024, open_timeout=10) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                  "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), 15))
            if m.get("id") == 1:
                res = m.get("result", {})
                if res.get("exceptionDetails"):
                    raise HarnessError(f"JS exception: {res['exceptionDetails'].get('text')}")
                return res.get("result", {}).get("value")


def js(expr):
    return asyncio.run(_eval(expr))


def try_js(expr):
    try:
        return js(expr)
    except Exception:
        return None


def has_testid(t):
    return bool(js("!!document.querySelector('[data-testid=%s]')" % json.dumps(t)))


def tap_testid(t):
    ok = js("(()=>{const e=document.querySelector('[data-testid=%s]');if(!e)return false;e.click();return true;})()"
            % json.dumps(t))
    if not ok:
        raise HarnessError(f"tap_testid: [data-testid={t}] not found")


# Row oracle: TransactionsPage.tsx:176-228. Face = [role=button] inside transaction-card;
# direct div children: title, body, [amount], timestamp, tags (5, or 4 when no amount).
ROWS_JS = r"""
(() => JSON.stringify({url: location.href, empty: !!document.querySelector('[data-testid=empty-state]'),
  rows: [...document.querySelectorAll('[data-testid=transaction-card]')].map(c => {
    const f = c.querySelector('[role=button]') || c;
    const d = [...f.children].filter(x => x.tagName === 'DIV').map(x => x.textContent);
    return {n: d.length, title: d[0] ?? null, body: d[1] ?? null, amountText: d.length === 5 ? d[2] : null};
  })}))()
"""
AMOUNT_RE = re.compile(r"^(-?\d+(?:\.\d+)?) ([A-Z]{3})$")
# API 35+ "sensitive notification" protection redacts OTP-looking content (4+ contiguous digits)
# for listeners without RECEIVE_SENSITIVE_NOTIFICATIONS -> body "Sensitive notification content hidden".
OTP_LIKE = re.compile(r"\d{4,}")


def parse_row(r):
    """DOM card -> {title, body, amount, currency, error?}. Pure (unit tested)."""
    row = {"title": r.get("title"), "body": r.get("body"), "amount": None, "currency": None}
    if r.get("n") not in (4, 5):
        row["error"] = f"unexpected card child count {r.get('n')}"
        return row
    if r.get("n") == 5:
        m = AMOUNT_RE.match((r.get("amountText") or "").strip())
        if not m:
            row["error"] = f"unparseable amount {r.get('amountText')!r}"
        else:
            row["amount"], row["currency"] = float(m.group(1)), m.group(2)
    else:
        row["currency_not_rendered"] = True
    return row


def read_rows():
    raw = json.loads(js(ROWS_JS))
    raw["rows"] = [parse_row(r) for r in raw["rows"]]
    return raw


def _key(row):
    amt = None if row.get("amount") is None else round(float(row["amount"]), 6)
    cur = None if amt is None else row.get("currency")  # currency not rendered when amount is null
    return (row.get("title"), row.get("body"), amt, cur)


def diff_rows(expected, actual):
    """Multiset compare. Returns (missing, extra) lists of rows. Pure (unit tested)."""
    rest = [_key(a) for a in actual]
    missing = []
    for e in expected:
        k = _key(e)
        if k in rest:
            rest.remove(k)
        else:
            missing.append(e)
    extra = [{"title": t, "body": b, "amount": a, "currency": c} for (t, b, a, c) in rest]
    return missing, extra


def show(rows):
    return [f"{r.get('title')!r}|{(r.get('body') or '')[:40]!r}|{r.get('amount')} {r.get('currency') or ''}".strip()
            for r in rows]


# --------------------------------------------------------------------------- poster
def poster_call(pkg, extras):
    nonce = uuid.uuid4().hex[:12]
    adb("logcat", "-c", check=False)
    args = ["shell", "am", "start", "--activity-clear-top", "-n", f"{pkg}/{POSTER_CLASS}", "--es", "nonce", nonce]
    for k, v in extras.items():
        if isinstance(v, bool):
            args += ["--ez", k, "true" if v else "false"]
        elif isinstance(v, int):
            args += ["--ei", k, str(v)]
        else:
            args += ["--es", k, str(v)]
    out = adb(*args)
    if "Error" in out:
        raise HarnessError(f"poster am start failed: {out.strip()[:200]}")
    deadline = time.time() + 8
    while time.time() < deadline:
        for line in adb("logcat", "-d", "-v", "raw", "-s", "TSPoster:I", check=False).splitlines():
            if nonce in line and "TSPOSTER " in line:
                rep = json.loads(line.split("TSPOSTER ", 1)[1])
                if not rep.get("ok"):
                    if rep.get("error") is None and extras.get("action") == "post":
                        wanted = extras.get("id")
                        actual = [n for n in rep.get("active", []) if n.get("id") == wanted and n.get("tag") is None]
                        if actual and actual[0].get("isSummary") != bool(extras.get("summary", False)):
                            raise Blocked(f"OS retained existing notification summary flag on id {wanted}; "
                                          f"requested summary={bool(extras.get('summary', False))}, "
                                          f"actual flags={actual[0].get('flags')}")
                    raise HarnessError(f"poster {extras.get('action','post')} not confirmed: {rep.get('error')}")
                # Post finishes asynchronously on the UI thread after logging. Let Activity.finish()
                # complete before another am start, or Android can deliver the next intent to the old Activity.
                time.sleep(0.5)
                return rep
        time.sleep(0.2)
    raise HarnessError("poster gave no TSPOSTER confirmation within 8s")


def b64(s):
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


def post_notification(spec, ctx):
    pkg = spec.get("package", POSTER)
    if not pkg_installed(pkg):
        raise HarnessError(f"poster package {pkg} not installed (run fixtures/build_poster.sh)")
    # Android am treats a bare empty --es value as the next option token. Use a
    # nonempty sentinel that Post.dec converts back to empty, preserving arg positions.
    title64, body64 = b64(spec.get("title", "")), b64(spec.get("body", ""))
    extras = {"action": "post", "id": int(spec["id"]), "t64": title64 or "~EMPTY~",
              "b64": body64 or "~EMPTY~", "summary": bool(spec.get("summary", False))} 
    if spec.get("group"):
        extras["group"] = spec["group"]
    rep = poster_call(pkg, extras)
    mine = [a for a in rep["active"] if a.get("id") == extras["id"] and a.get("tag") is None]
    if not mine or mine[0].get("isSummary") != extras["summary"]:
        raise HarnessError(f"native record for id {extras['id']} missing/flags wrong: {mine}")
    ctx["posts"].append({"pkg": pkg, "id": extras["id"], "summary": extras["summary"],
                         "group": spec.get("group"), "postTime": mine[0]["postTime"],
                         "flags": mine[0]["flags"]})
    time.sleep(0.3)


def clear_notifications(ctx):
    for pkg in (POSTER, POSTER_OTHER):
        if pkg_installed(pkg):
            poster_call(pkg, {"action": "cancelAll"})


def native_autogroup_present(timeout=6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        dump = sh("dumpsys notification --noredact")
        for line in dump.splitlines():
            if f"|{POSTER}|" in line and "ranker_group" in line:
                return True, line.strip()[:200]
        time.sleep(0.5)
    return False, None


def listener_bound():
    dump = sh("dumpsys notification")
    m = re.search(r"Live notification listeners[^\n]*\n((?:\s+.*\n){0,20})", dump)
    return bool(m and APP in m.group(1))


# --------------------------------------------------------------------------- app lifecycle
def launch():
    adb("shell", "am", "start", "-n", APP_ACTIVITY)


def wait_app_ready(timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if try_js("!!document.querySelector('[data-testid=nav-transactions]')"):
            return
        top = sh("dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity'")
        if APP not in top:
            adb("shell", "input", "keyevent", "KEYCODE_BACK", check=False)
            time.sleep(0.7)
            launch()
        time.sleep(1)
    raise HarnessError("app UI (nav-transactions) not ready within timeout")


def grant_all():
    sh(f"pm grant {APP} android.permission.POST_NOTIFICATIONS")
    for pkg in (POSTER, POSTER_OTHER):
        if pkg_installed(pkg):
            sh(f"pm grant {pkg} android.permission.POST_NOTIFICATIONS")
    out = sh(f"cmd notification allow_listener {LISTENER}")
    if out.strip():
        raise HarnessError(f"allow_listener: {out.strip()[:200]}")
    sh(f"dumpsys deviceidle whitelist +{APP}")


def reset_app(ctx):
    clear_notifications(ctx)
    if "Success" not in adb("shell", "pm", "clear", APP):
        raise HarnessError("pm clear failed")
    grant_all()
    launch()
    wait_app_ready()
    tap_testid("nav-transactions")
    time.sleep(1)
    rows = read_rows()
    if rows["rows"]:
        raise HarnessError(f"reset baseline not empty: {show(rows['rows'])}")
    clear_notifications(ctx)


def restart_app(ctx):
    adb("shell", "am", "force-stop", APP)
    time.sleep(1)
    launch()
    wait_app_ready()
    # Force-stop unbinds the listener; the snapshot path needs it rebound. Record evidence.
    deadline = time.time() + 10
    while time.time() < deadline and not listener_bound():
        time.sleep(0.5)
    bound = listener_bound()
    ctx["evidence"]["listener_bound_after_restart"] = bound
    if not bound:
        raise Blocked("listener not rebound after force-stop; snapshot path not exercised")


# --------------------------------------------------------------------------- assertions
def check_code(spec, rows_state):
    fails = []
    url = rows_state["url"]
    rows = rows_state["rows"]
    for k in spec:
        if k not in CODE_ASSERT_KEYS:
            raise HarnessError(f"unknown code_assert key {k}")
    if "url_endswith" in spec and not url.rstrip("/").endswith(spec["url_endswith"].rstrip("/")):
        fails.append(f"url {url} !endswith {spec['url_endswith']}")
    if "url_contains" in spec and spec["url_contains"] not in url:
        fails.append(f"url {url} !contains {spec['url_contains']}")
    for t in spec.get("testid_present", []):
        if not has_testid(t):
            fails.append(f"testid missing: {t}")
    for t in spec.get("testid_absent", []):
        if has_testid(t):
            fails.append(f"testid should be absent: {t}")
    if spec.get("text_present"):
        body = js("document.body.innerText") or ""
        fails += [f"text missing: {t!r}" for t in spec["text_present"] if t not in body]
    if "row_count" in spec and len(rows) != spec["row_count"]:
        fails.append(f"row_count {len(rows)} != {spec['row_count']}")
    if "rows_equal" in spec:
        missing, extra = diff_rows(spec["rows_equal"], rows)
        if missing:
            fails.append(f"missing rows: {show(missing)}")
        if extra:
            fails.append(f"unexpected rows: {show(extra)}")
    if spec.get("no_empty_rows"):
        bad = [r for r in rows if not (r.get("title") or "").strip() or not (r.get("body") or "").strip()
               or r.get("amount") is None]
        if bad:
            fails.append(f"empty/amountless rows: {show(bad)}")
    errs = [r["error"] for r in rows if r.get("error")]
    if errs:
        fails.append(f"row parse errors: {errs}")
    return fails


def await_rows(spec, ctx):
    expected = spec["expected"]
    timeout = float(spec.get("timeout", 15))
    stable = float(spec.get("stable_seconds", 3))
    deadline = time.time() + timeout
    matched_since = None
    last = None
    while time.time() < deadline:
        last = read_rows()
        missing, extra = diff_rows(expected, last["rows"])
        if not missing and not extra:
            matched_since = matched_since or time.time()
            if time.time() - matched_since >= stable:
                break
        else:
            matched_since = None
        time.sleep(0.1 if expected else 0.5)
    # extra observation window: late/duplicate rows must not appear
    time.sleep(3)
    last = read_rows()
    ctx["final_rows"] = last
    return last


def checkpoint(spec, ctx):
    want = spec.get("row_count")
    deadline = time.time() + 15
    while time.time() < deadline:
        st = read_rows()
        if want is None or len(st["rows"]) == want:
            time.sleep(2)
            st = read_rows()
            break
        time.sleep(0.3)
    ctx["checkpoints"].append(st)
    fails = check_code(spec, st)
    if fails:
        raise AssertFail(f"checkpoint#{len(ctx['checkpoints'])}: " + "; ".join(fails))


def run_nav(steps, ctx):
    for step in steps:
        if isinstance(step, str):
            {"reset_app": reset_app, "clear_notifications": clear_notifications,
             "launch": lambda c: launch()}[step](ctx)
            continue
        (op, arg), = step.items()
        if op == "sleep":
            time.sleep(float(arg))
        elif op == "tap_testid":
            tap_testid(arg)
        elif op == "post_notification":
            post_notification(arg, ctx)
        elif op == "cancel_notification":
            poster_call(arg.get("package", POSTER), {"action": "cancel", "id": int(arg["id"])})
        elif op == "native_assert":
            if arg.get("autogroup_summary_present"):
                ok, line = native_autogroup_present()
                ctx["evidence"]["autogroup_summary"] = line
                if not ok:
                    raise Blocked("OS posted no autogroup summary (dumpsys has no ranker_group record)")
        elif op == "checkpoint":
            checkpoint(arg, ctx)
        elif op == "restart_app":
            restart_app(ctx)
        elif op == "await_rows":
            await_rows(arg, ctx)


def check_timing(guard, posts):
    if not guard or len(posts) < 2:
        return None
    delta = (posts[-1]["postTime"] - posts[0]["postTime"]) / 1000.0
    if "max_post_delta_s" in guard and delta > guard["max_post_delta_s"]:
        return f"post delta {delta:.3f}s > {guard['max_post_delta_s']}s (too slow to test dedup window)"
    if "min_post_delta_s" in guard and delta < guard["min_post_delta_s"]:
        return f"post delta {delta:.3f}s < {guard['min_post_delta_s']}s"
    return None


def run_jev(asserts, rows_state):
    if not asserts:
        return {}, []
    sys.path.insert(0, HERE)
    import jev
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if len(key) < 20:
        raise HarnessError("TYPESAFE_API_KEY not set")
    state = {"screen": {"url": rows_state["url"], "rows": rows_state["rows"]}}
    try:
        nouls = jev.batch_nouls(state, asserts, key)
    except Exception as e:
        raise HarnessError(f"Jev call failed: {type(e).__name__}")
    res, fails = {}, []
    for a in asserts:
        if a["id"] not in nouls:
            raise HarnessError(f"Jev returned no answer for {a['id']}")
        res[a["id"]] = nouls[a["id"]]
        if nouls[a["id"]] < 0.8:
            fails.append(f"jev {a['id']}={nouls[a['id']]:.2f}<0.8")
    return res, fails


def run_ui(sc):
    ctx = {"posts": [], "checkpoints": [], "evidence": {}, "final_rows": None}
    res = {"id": sc["id"], "feature": sc.get("feature", ""), "kind": "ui",
           "known_red": bool(sc.get("known_red")), "hint": sc.get("hint")}
    try:
        run_nav(sc["nav"], ctx)
        terr = check_timing(sc.get("timing_guard"), ctx["posts"])
        if terr:
            raise HarnessError("timing_guard: " + terr)
        st = ctx["final_rows"] or read_rows()
        fails = check_code(sc.get("code_assert", {}), st)
        jres, jfails = run_jev(sc.get("jev_assert") or [], st)
        res["jev"] = jres
        fails += jfails
        res["verdict"] = "FAIL" if fails else "PASS"
        res["fails"] = fails
    except AssertFail as e:
        res["verdict"], res["fails"] = "FAIL", [str(e)]
    except Blocked as e:
        res["verdict"], res["fails"] = "BLOCKED", [str(e)]
    except Exception as e:
        res["verdict"], res["fails"] = "ERROR", [f"{type(e).__name__}: {e}"]
    res["posts"] = ctx["posts"]
    res["evidence"] = ctx["evidence"]
    with open(os.path.join(OUT, f"{sc['id']}_rows.json"), "w", encoding="utf-8") as f:
        json.dump({"final": ctx["final_rows"], "checkpoints": ctx["checkpoints"], "posts": ctx["posts"],
                   "evidence": ctx["evidence"]}, f, ensure_ascii=False, indent=1)
    return res


def run_vitest(sc):
    npx = shutil.which("npx.cmd") or shutil.which("npx")
    r = subprocess.run([npx, "vitest", "run", *sc["vitest_files"]], cwd=REPO, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    return {"id": sc["id"], "feature": sc.get("feature", ""), "kind": "vitest",
            "verdict": "PASS" if r.returncode == 0 else "FAIL",
            "fails": [] if r.returncode == 0 else tail, "hint": sc.get("hint")}


# --------------------------------------------------------------------------- validation
def normalize_unicode(value):
    """PyYAML preserves JSON-style UTF-16 surrogate escapes as lone code points; combine emoji pairs."""
    if isinstance(value, str):
        return value.encode("utf-16", "surrogatepass").decode("utf-16")
    if isinstance(value, list):
        return [normalize_unicode(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize_unicode(v) for k, v in value.items()}
    return value


def validate(spec):
    errs, ids = [], set()
    for sc in spec.get("scenarios", []):
        sid = sc.get("id", "?")
        if sid in ids:
            errs.append(f"{sid}: duplicate id")
        ids.add(sid)
        for k in sc:
            if k not in SCENARIO_KEYS:
                errs.append(f"{sid}: unknown key {k}")
        if sc.get("kind") == "vitest":
            for f in sc.get("vitest_files", []):
                if not os.path.exists(os.path.join(REPO, f)):
                    errs.append(f"{sid}: vitest file missing {f}")
            continue
        for st in sc.get("nav", []):
            if isinstance(st, dict) and "post_notification" in st and "otp" not in sid.lower():
                p = st["post_notification"]
                if OTP_LIKE.search(p.get("title", "") + " " + p.get("body", "")):
                    errs.append(f"{sid}: contiguous 4+ digit number in payload triggers Android 15 OTP "
                                "redaction; use NBSP thousands grouping like real Revolut (1\\u00a0000)")
        for st in sc.get("nav", []):
            if isinstance(st, str):
                if st not in NAV_STRING_OPS:
                    errs.append(f"{sid}: unknown nav op {st}")
            elif isinstance(st, dict) and len(st) == 1:
                op = next(iter(st))
                if op not in NAV_DICT_OPS:
                    errs.append(f"{sid}: unknown nav op {op}")
            else:
                errs.append(f"{sid}: bad nav step {st!r}")
        for k in sc.get("code_assert", {}):
            if k not in CODE_ASSERT_KEYS:
                errs.append(f"{sid}: unknown code_assert {k}")
        if sc.get("nav", [None])[0] != "reset_app":
            errs.append(f"{sid}: first nav step must be reset_app (self-contained)")
    return errs


def preflight():
    devs = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
    if not re.search(rf"^{re.escape(SERIAL)}\s+device$", devs, re.M):
        raise HarnessError(f"{SERIAL} not attached")
    if sh("getprop sys.boot_completed").strip() != "1":
        raise HarnessError("emulator not booted")
    if sh("getprop ro.kernel.qemu").strip() != "1" and not SERIAL.startswith("emulator-"):
        raise HarnessError("target is not an emulator")
    for p in (APP, POSTER):
        if not pkg_installed(p):
            raise HarnessError(f"{p} not installed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--no-vitest", action="store_true")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--tag", default="", help="report file suffix (chunked runs): report_<tag>.json")
    a = ap.parse_args()
    with open(SCENARIOS, encoding="utf-8") as f:
        spec = normalize_unicode(yaml.safe_load(f))
    errs = validate(spec)
    if errs or a.validate:
        log("\n".join(errs) if errs else f"VALID: {len(spec['scenarios'])} scenarios")
        return 2 if errs else 0
    only = [p.strip() for p in a.only.split(",") if p.strip()]
    scs = [s for s in spec["scenarios"] if not only or any(s["id"].startswith(p) for p in only)]
    if a.list:
        for s in scs:
            log(f"{s['id']}  {s.get('feature','')}")
        return 0
    os.makedirs(OUT, exist_ok=True)
    if any(s.get("kind") != "vitest" for s in scs):
        try:
            preflight()
        except HarnessError as e:
            log(f"ABORT preflight: {e}")
            return 3
    results = []
    for sc in scs:
        log(f"=== {sc['id']} - {sc.get('feature','')}")
        if sc.get("kind") == "vitest":
            r = {"id": sc["id"], "kind": "vitest", "verdict": "NOT_RUN", "fails": ["--no-vitest"]} \
                if a.no_vitest else run_vitest(sc)
        else:
            r = run_ui(sc)
        results.append(r)
        tag = " (known_red)" if r.get("known_red") else ""
        log(f"[{r['verdict']}] {sc['id']}{tag} " + " | ".join(r.get("fails") or []))
    if not only:
        results.append({"id": "NATIVE-Q", "kind": "native", "verdict": "NOT_RUN",
                        "fails": ["Kotlin queue/mask unit gate has no JVM test harness in repo; not covered"]})
    report = os.path.join(OUT, f"report_{a.tag}.json" if a.tag else "report.json")
    with open(report, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    counted = [r for r in results if r["id"] != "NATIVE-Q"]
    npass = sum(r["verdict"] == "PASS" for r in counted)
    log(f"\nSUMMARY {npass}/{len(counted)} PASS")
    for r in results:
        log(f"  {r['verdict']:8} {r['id']}{' (known_red)' if r.get('known_red') else ''}")
    log(f"Report: {report}")
    return 0 if npass == len(counted) else 1


if __name__ == "__main__":
    raise SystemExit(main())
