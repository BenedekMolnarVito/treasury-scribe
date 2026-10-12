#!/usr/bin/env python
"""
Undelete-button smoke runner (UD1-UD6). Semi-deterministic: fixed nav steps +
hard CDP-DOM asserts; Jev = one request per scenario (Noul verdict + Choice
action), advisory only — dumped DOM wins on conflict.

UNSPECIFIEDs resolved from repo (PLAN.md):
 1. DATABASE_STORAGE_KEY = "treasury-scribe.sqlite" (DatabaseService.ts:12)
 2. Add-modal selectors: fab-add; inputs by placeholder Title/Amount/Currency;
    datetime by testid input-datetime; submit = form button[type=submit]
    ("Add Transaction"); edit title = testid input-title.
 3. No repo fn exposed to window -> soft-delete via base64 fixture patch:
    pull localStorage[key] (bytesToBase64(db.export()) shape,
    DatabaseService.ts:151-174), UPDATE Transactions SET IsDeleted=1 in
    python sqlite3, push back, reload.
 4. Storage assert done via fixture readback (no on-device SQLite file).
 5. No window.confirm path used (no swipe).

Windows: git-bash for cdp._adb, ANDROID_SERIAL=emulator-5554 everywhere.
Dumps + report.json -> .maestro/smoke_out/undelete-button/.
"""
import sys, os, json, time, base64, sqlite3, tempfile, traceback

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO, ".maestro", "smoke"))

SERIAL = os.environ.get("ANDROID_SERIAL") or (sys.argv[1] if len(sys.argv) > 1 else "emulator-5554")
os.environ["ANDROID_SERIAL"] = SERIAL

import cdp, jev  # noqa: E402
import subprocess  # noqa: E402

# --- Windows monkeypatch: System32 bash is WSL; use git-bash ---------------
GITBASH = "C:/Program Files/Git/bin/bash.exe"

def _adb_win(cmd: str) -> str:
    src = f'[ -f "{cdp.ENV_SH}" ] && source "{cdp.ENV_SH}"; ' if os.path.exists(cdp.ENV_SH) else ""
    return subprocess.run([GITBASH, "-c", src + cmd], capture_output=True, text=True,
                          env={**os.environ, "ANDROID_SERIAL": SERIAL}).stdout

cdp._adb = _adb_win

OUT = os.environ.get("SMOKE_OUT") or os.path.join(REPO, ".maestro", "smoke_out", "undelete-button")
os.makedirs(OUT, exist_ok=True)
DB_KEY = "treasury-scribe.sqlite"

# --- primitives -------------------------------------------------------------

def reload_app() -> None:
    cdp.eval_js("location.reload()")
    time.sleep(2.5)

def nav(path: str) -> str:
    js = ("window.history.pushState({}, '', %s); "
          "window.dispatchEvent(new PopStateEvent('popstate'));" % json.dumps(path))
    cdp.eval_js(js)
    time.sleep(1.2)
    url = cdp.eval_js("location.pathname")
    if path not in (url or ""):
        raise RuntimeError(f"nav failed: wanted {path}, got {url}")
    return url

def dump(name: str) -> dict:
    dom = cdp.extract_dom()
    dom["pathname"] = cdp.eval_js("location.pathname")
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(dom, f, indent=1, ensure_ascii=False)
    return dom

def wait_for_testid(testid: str, timeout: float = 8.0) -> bool:
    js = ("(()=>{const el=document.querySelector('[data-testid=\"%s\"]');"
          "return !!(el && el.getBoundingClientRect().width>0);})()" % testid)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if cdp.eval_js(js):
            return True
        time.sleep(0.5)
    return False

def wait_for_any(testids, timeout: float = 8.0) -> bool:
    return any(wait_for_testid(t, timeout=max(1.0, timeout / len(testids))) for t in testids)

def dump_has_testid(dom: dict, testid: str) -> bool:
    return any(e.get("testid") == testid for e in dom["els"])

def body_text() -> str:
    return (cdp.eval_js("document.body.innerText") or "")

def reset_and_seed(title: str, soft_delete: bool) -> int:
    """Fresh DB, seed one txn via Add modal; optionally soft-delete via
    base64 fixture patch. Returns the row Id."""
    cdp.launch()
    time.sleep(1.5)
    # Hard nav to app root: reload at the previous scenario's /edit/<old-id>
    # URL against a wiped DB crashes the tree (missing txn), making pushState
    # nav inert. location.href forces a full page load at a safe route.
    cdp.eval_js(f"localStorage.removeItem({json.dumps(DB_KEY)})")
    cdp.eval_js("location.href = location.origin + '/'")
    time.sleep(3)
    nav("/transactions")
    if not wait_for_testid("fab-add", 10.0):
        dump("err-fab-missing.json")
        raise RuntimeError("fab-add not visible within 10s")
    if not cdp.tap_testid("fab-add"):
        raise RuntimeError("fab-add not clickable")
    time.sleep(0.8)
    for key, val in (("Title", title), ("Amount", "1234"), ("Currency", "HUF"),
                     ("input-datetime", "2026-10-12T10:30")):
        if not cdp.set_input(key, val):
            raise RuntimeError(f"add-modal input not found: {key}")
    time.sleep(0.3)
    ok = cdp.eval_js(
        "(()=>{const b=[...document.querySelectorAll('button[type=submit]')]"
        ".find(x=>x.innerText.trim()==='Add Transaction');"
        "if(!b)return false;b.click();return true;})()")
    if not ok:
        raise RuntimeError("add-modal submit button not found")
    time.sleep(0.8)
    for attempt in range(3):
        try:
            return patch_fixture(title, deleted=1 if soft_delete else 0)
        except RuntimeError:
            if attempt == 2:
                raise
            time.sleep(1.0)
    raise RuntimeError("patch_fixture failed")

def nav_edit(rid: int) -> None:
    nav(f"/edit/{rid}")
    if not wait_for_any(("btn-save", "btn-undelete", "no-db-message"), 10.0):
        dump("err-edit-not-loaded.json")
    time.sleep(0.5)

def pull_db() -> bytes:
    b64 = cdp.eval_js(f"localStorage.getItem({json.dumps(DB_KEY)})")
    if not b64:
        raise RuntimeError("no persisted DB in localStorage")
    return base64.b64decode(b64)

def push_db(raw: bytes) -> None:
    b64 = base64.b64encode(raw).decode()
    cdp.eval_js(f"localStorage.setItem({json.dumps(DB_KEY)}, {json.dumps(b64)})")

def _with_con(raw: bytes, fn):
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        con = sqlite3.connect(path)
        try:
            return fn(con)
        finally:
            con.close()
    finally:
        os.unlink(path)

def find_row(con, marker: str) -> int:
    rows = con.execute(
        "SELECT Id, RawContent, JsonContent, NotificationTitle, NotificationBody "
        "FROM Transactions").fetchall()
    hits = [r[0] for r in rows if any(marker in str(v) for v in r[1:])]
    if not hits:
        raise RuntimeError(f"seed row with marker {marker!r} not found in fixture")
    return hits[0]

def patch_fixture(marker: str, deleted: int) -> int:
    def fn(con):
        rid = find_row(con, marker)
        con.execute("UPDATE Transactions SET IsDeleted=? WHERE Id=?", (deleted, rid))
        con.commit()
        return rid
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(pull_db())
        con = sqlite3.connect(path)
        try:
            rid = fn(con)
        finally:
            con.close()
        with open(path, "rb") as f:
            push_db(f.read())
        return rid
    finally:
        os.unlink(path)

def read_isdeleted(marker: str) -> int:
    def fn(con):
        return con.execute("SELECT IsDeleted FROM Transactions WHERE Id=?",
                           (find_row(con, marker),)).fetchone()[0]
    return int(_with_con(pull_db(), fn))

# --- Jev verdict + action in ONE request ------------------------------------

def jev_verdict_action(dom: dict, goal_true: str, goal_false: str, key: str) -> dict:
    els = [{"i": e["i"], "kind": e["kind"], "text": e["text"]} for e in dom["els"]]
    interactive = [e for e in els if e["kind"] == "interactive"]
    state = {"screen": {"url": dom.get("url"), "elements": els}}
    questions = {
        "goal_reached": {"type": "noul",
                         "instructions": {"question": "Has the scenario goal been reached by the screen elements?"},
                         "criteria": {"true": goal_true, "false": goal_false}},
        "next_action": {"type": "choice",
                        "instructions": {"question": "Which element would you tap next to confirm the goal?"},
                        "criteria": {str(e["i"]): e["text"] for e in interactive} or {"-1": "none"}},
    }
    resp = jev._post({"state": state, "model": jev.JEV_MODEL, "questions": questions}, key)
    ans = resp.get("answers", {})
    return {"goal_reached": float(ans.get("goal_reached", {}).get("noul", 0.0)),
            "next_action": ans.get("next_action", {}).get("choice"),
            "usage": resp.get("usage", {})}

# --- scenarios ---------------------------------------------------------------
# each returns (hard_asserts: list of (name, expected, got, ok), extra dict)

def sc_ud1(key):
    title = "UD1-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=True)
    reload_app()
    nav_edit(rid)
    dom = dump("ud1.json")
    txt = body_text()
    a = [("url_contains /edit/", "/edit/", dom.get("url"), "/edit/" in str(dom.get("url"))),
         ("testid deleted-banner", "present", dump_has_testid(dom, "deleted-banner"), dump_has_testid(dom, "deleted-banner")),
         ("testid btn-undelete", "present", dump_has_testid(dom, "btn-undelete"), dump_has_testid(dom, "btn-undelete")),
         ("text 'This transaction is deleted'", "present", "This transaction is deleted" in txt,
          "This transaction is deleted" in txt)]
    return a, {"seed_id": rid, "title": title}

def sc_ud2(key):
    title = "UD2-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=False)
    nav_edit(rid)
    dom = dump("ud2.json")
    a = [("url_contains /edit/", "/edit/", dom.get("url"), "/edit/" in str(dom.get("url"))),
         ("testid btn-save", "present", dump_has_testid(dom, "btn-save"), dump_has_testid(dom, "btn-save")),
         ("testid deleted-banner", "absent", dump_has_testid(dom, "deleted-banner"), not dump_has_testid(dom, "deleted-banner")),
         ("testid btn-undelete", "absent", dump_has_testid(dom, "btn-undelete"), not dump_has_testid(dom, "btn-undelete"))]
    return a, {"seed_id": rid, "title": title}

def sc_ud3(key):
    title = "UD3-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=True)
    reload_app()
    nav_edit(rid)
    pre = dump_has_testid(cdp.extract_dom(), "btn-undelete")
    if not pre:
        raise RuntimeError("precondition btn-undelete not present")
    cdp.tap_testid("btn-undelete")
    time.sleep(1.5)
    d1 = dump("ud3-edit.json")
    nav("/transactions")
    time.sleep(1.5)
    d2 = dump("ud3-list.json")
    in_list = title in body_text()
    store = read_isdeleted(title)
    a = [("ud3-edit: deleted-banner absent", "absent", dump_has_testid(d1, "deleted-banner"), not dump_has_testid(d1, "deleted-banner")),
         ("ud3-edit: btn-undelete absent", "absent", dump_has_testid(d1, "btn-undelete"), not dump_has_testid(d1, "btn-undelete")),
         ("ud3-list: seeded title present", "present", in_list, in_list),
         ("storage IsDeleted", 0, store, store == 0)]
    return a, {"seed_id": rid, "title": title}

def sc_ud4(key):
    title = "UD4-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=True)
    reload_app()
    nav_edit(rid)
    if not dump_has_testid(cdp.extract_dom(), "btn-undelete"):
        raise RuntimeError("precondition btn-undelete not present")
    cdp.tap_testid("btn-undelete")
    time.sleep(0.8)
    cdp.tap_testid("btn-undelete")  # second click: no-op if unmounted
    time.sleep(1.0)
    dom = dump("ud4.json")
    a = [("url_contains /edit/", "/edit/", dom.get("url"), "/edit/" in str(dom.get("url"))),
         ("testid btn-save", "present", dump_has_testid(dom, "btn-save"), dump_has_testid(dom, "btn-save")),
         ("testid deleted-banner", "absent", dump_has_testid(dom, "deleted-banner"), not dump_has_testid(dom, "deleted-banner")),
         ("testid btn-undelete", "absent", dump_has_testid(dom, "btn-undelete"), not dump_has_testid(dom, "btn-undelete"))]
    return a, {"seed_id": rid, "title": title}

def sc_ud5(key):
    title = "UD5-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=False)
    nav_edit(rid)
    new_title = title + "R2"
    if not cdp.set_input("input-title", new_title):
        raise RuntimeError("input-title not found")
    cdp.tap_testid("btn-save")
    time.sleep(1.5)
    dom = dump("ud5.json")
    no_banner = not dump_has_testid(dom, "deleted-banner")
    reload_app()
    nav_edit(rid)
    got = cdp.eval_js("(()=>{const el=document.querySelector('[data-testid=\\\"input-title\\\"]');return el?el.value:null;})()")
    a = [("ud5: deleted-banner absent", "absent", dump_has_testid(dom, "deleted-banner"), no_banner),
         ("title persisted on reload", new_title, got, got == new_title)]
    return a, {"seed_id": rid, "title": title}

def sc_ud6(key):
    title = "UD6-SEED-7Q"
    rid = reset_and_seed(title, soft_delete=False)
    nav_edit(rid)
    cdp.tap_testid("edit-back-button")
    time.sleep(1.5)
    dom = dump("ud6.json")
    a = [("url_is /transactions", "/transactions", dom.get("pathname"), dom.get("pathname") == "/transactions")]
    return a, {"seed_id": rid, "title": title}

SCENARIOS = [
    ("UD1", sc_ud1, "deleted txn shows banner + Undelete button",
     "Edit screen shows a deleted banner reading 'This transaction is deleted' and an Undelete button",
     "No banner/button, wrong screen, or an error/empty state"),
    ("UD2", sc_ud2, "active txn shows no banner or button",
     "Edit screen of an active transaction shows a Save button and NO deleted banner / Undelete button",
     "Banner or Undelete button visible, or screen is not the edit form"),
    ("UD3", sc_ud3, "click Undelete restores txn (banner gone + list membership)",
     "After clicking Undelete the banner and button are gone and the transaction reappears in the transactions list",
     "Banner/button still present or transaction missing from list"),
    ("UD4", sc_ud4, "double-click Undelete stays consistent (idempotent)",
     "After clicking Undelete twice the edit screen is stable: Save visible, no banner, no Undelete button, no error",
     "Banner/button reappeared, error shown, or inconsistent state"),
    ("UD5", sc_ud5, "regression - edit plus save active txn works, no banner",
     "After editing the title and saving, no deleted banner appears and the new title persists after reload",
     "Banner appears, title lost, or save failed"),
    ("UD6", sc_ud6, "regression - Back returns to transactions list",
     "The app is on the transactions list (/transactions) after tapping the Back button on the edit screen",
     "Still on edit screen or any other screen"),
]

def main() -> int:
    key = jev.load_key()
    assert len(key) > 20, "TYPESAFE_API_KEY not loaded"
    cdp.launch()
    time.sleep(3)
    report = {"scenarios": []}
    n_pass = 0
    for sid, fn, purpose, goal_true, goal_false in SCENARIOS:
        entry = {"id": sid, "purpose": purpose}
        try:
            asserts, extra = fn(key)
            hard_ok = all(a[3] for a in asserts)
            entry["asserts"] = [{"name": a[0], "expected": a[1], "got": a[2], "ok": bool(a[3])} for a in asserts]
            entry.update(extra)
            doms = {"ud1": "ud1.json", "ud2": "ud2.json", "ud3": "ud3-edit.json",
                    "ud4": "ud4.json", "ud5": "ud5.json", "ud6": "ud6.json"}
            with open(os.path.join(OUT, doms[sid.lower()]), encoding="utf-8") as f:
                last_dom = json.load(f)
            jv = jev_verdict_action(last_dom, goal_true, goal_false, key)
            entry["jev"] = jv
            if hard_ok:
                verdict = "PASS"  # DOM wins over noisy Jev scores
                n_pass += 1
            else:
                verdict = "FAIL"
            entry["verdict"] = verdict
        except Exception as e:
            entry["verdict"] = "FAIL"
            entry["error"] = f"{e}"
            entry["trace"] = traceback.format_exc()[-1200:]
            entry.setdefault("asserts", [])
            try:
                dump(f"err-{sid.lower()}.json")
            except Exception:
                pass
        report["scenarios"].append(entry)
        print(f"[{entry['verdict']:4}] {sid} — {purpose}" +
              (f"  ERR={entry.get('error')}" if "error" in entry else ""))
        for a in entry.get("asserts", []):
            if not a["ok"]:
                print(f"       FAIL {a['name']}: expected={a['expected']!r} got={a['got']!r}")
    report["summary"] = f"{n_pass}/{len(SCENARIOS)} PASS"
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)
    print(report["summary"])
    return 0 if n_pass == len(SCENARIOS) else 1

if __name__ == "__main__":
    raise SystemExit(main())
