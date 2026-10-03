#!/usr/bin/env python3
"""
DOM-driven, JEV-decided behavioral test runner for the Treasury Scribe
Capacitor/Android app running on an emulator.

Pattern (browser-use applied to an Android WebView):
  1. Extract a DISTILLED DOM snapshot from the app's WebView over the
     Chrome DevTools Protocol (CDP) -- structured elements + text, no pixels.
  2. Feed that state to TypeSafe's Jev System One model, which returns TYPED
     judgments: a Noul (yes/no probability) for the pass/fail verdict and a
     Choice for the next action / target element.
  3. Code owns the loop: execute the chosen action via a semantic CDP DOM
     click, re-extract, and re-judge until the scenario goal is reached.

Why CDP, not uiautomator/pixels: a Capacitor app is a Chromium WebView whose
DOM is NOT exposed to the Android accessibility tree, so uiautomator sees
nothing and screenshots need OCR. CDP gives the real DOM directly.

Prereqs (all set up by the android-env.sh this references):
  - emulator booted, app installed, foregrounded
  - TYPESAFE_API_KEY in env (loaded from ~/.zshrc)
  - python: websockets (stdlib asyncio); urllib for the Jev HTTPS call

GOTCHA: the WebView devtools unix socket PID changes when the WebView process
respawns, so we RE-RESOLVE the live socket and re-forward on every CDP call.
GOTCHA: host Chrome may already hold :9222 -- we forward to :9333 instead.
"""
import asyncio, json, os, subprocess, time, urllib.request, urllib.error
import websockets

TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-latest"
LOCAL_PORT = 9333


def load_key() -> str:
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k.strip()
    r = subprocess.run(
        ["zsh", "-c", "source ~/.zshrc >/dev/null 2>&1; printf '%s\\0' \"$TYPESAFE_API_KEY\""],
        capture_output=True,
    )
    return r.stdout.split(b"\0")[0].decode().strip()


def _adb(cmd: str) -> str:
    full = f'source "$HOME/.hermes/cache/scratch/android-env.sh"; {cmd}'
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True).stdout


def live_ws() -> str:
    """Re-resolve the current WebView CDP socket and forward it; return page WS url."""
    _adb("adb forward --remove-all 2>/dev/null >/dev/null")
    sock = _adb("adb shell cat /proc/net/unix | grep -oE 'webview_devtools_remote_[0-9]+' | head -1").strip()
    if not sock:
        raise RuntimeError("No WebView devtools socket. Is the app foregrounded?")
    _adb(f"adb forward tcp:{LOCAL_PORT} localabstract:{sock} >/dev/null")
    listing = _adb(f"curl -s -m5 http://127.0.0.1:{LOCAL_PORT}/json/list")
    pages = [t for t in json.loads(listing) if t.get("type") == "page"]
    if not pages:
        raise RuntimeError("No CDP page target found.")
    return pages[0]["webSocketDebuggerUrl"]


DISTILL_JS = r"""
(() => {
  const out=[]; let idx=0;
  const vis=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';};
  const seen=new Set();
  document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=tab],[role=link],[onclick],[tabindex]').forEach(el=>{
    if(!vis(el))return; const r=el.getBoundingClientRect();
    out.push({i:idx++,kind:'interactive',tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||null,
      type:el.getAttribute('type')||null,
      text:(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim().slice(0,80),
      box:[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]});
    seen.add(el);});
  document.querySelectorAll('h1,h2,h3,h4,label,span,p,div').forEach(el=>{
    if(seen.has(el)||el.children.length>0||!vis(el))return;
    const t=(el.innerText||'').trim(); if(!t||t.length>80)return;
    out.push({i:idx++,kind:'text',tag:el.tagName.toLowerCase(),text:t.slice(0,80)});});
  return JSON.stringify({title:document.title,url:location.href,count:out.length,els:out});
})()
"""


def _tap_js(text: str) -> str:
    safe = json.dumps(text)
    return (
        "(() => {const want=" + safe + ";"
        "const c=[...document.querySelectorAll('a,button,[role=button],[role=tab],span,div')]"
        ".filter(el=>el.getBoundingClientRect().width>0 && (el.innerText||'').trim()===want);"
        "if(!c.length) return JSON.stringify({ok:false});"
        "c.sort((a,b)=>{const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();"
        "return ra.width*ra.height-rb.width*rb.height;});"
        "c[0].click(); return JSON.stringify({ok:true});})()"
    )


async def _eval(expr: str):
    async with websockets.connect(live_ws(), max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        await ws.recv()
        await ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate",
                                  "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == 2:
                return m.get("result", {}).get("result", {}).get("value")


def extract_dom() -> dict:
    return json.loads(asyncio.run(_eval(DISTILL_JS)))


def tap_text(text: str) -> dict:
    return json.loads(asyncio.run(_eval(_tap_js(text))))


def jev(state: dict, questions: dict, key: str) -> dict:
    body = {"state": state, "model": JEV_MODEL, "questions": questions}
    req = urllib.request.Request(TYPESAFE_URL, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                 method="POST")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["answers"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("Jev request failed after retries")


def run_scenario(scenario: str, success_true: str, success_false: str,
                 key: str, max_steps: int = 6, pass_threshold: float = 0.8) -> dict:
    """Drive the app toward `scenario` using Jev for every decision. Returns a verdict dict."""
    trace = []
    for step in range(1, max_steps + 1):
        dom = extract_dom()
        els = [{"i": e["i"], "kind": e["kind"], "text": e["text"]} for e in dom["els"]]
        interactive = [e for e in els if e["kind"] == "interactive"]
        state = {"scenario": scenario, "screen": {"title": dom["title"], "elements": els}}
        questions = {
            "goal_reached": {"type": "noul",
                "instructions": {"question": "Has the scenario goal in `scenario` been reached by `screen.elements`?",
                                 "scenario": scenario},
                "criteria": {"true": success_true, "false": success_false}},
            "target_element": {"type": "choice",
                "instructions": {"question": "Which interactive element index should be tapped NEXT to progress toward the goal?",
                                 "scenario": scenario},
                "criteria": {str(e["i"]): e["text"] for e in interactive} or {"-1": "none"}},
        }
        ans = jev(state, questions, key)
        goal = ans["goal_reached"]["noul"]
        trace.append({"step": step, "title": dom["title"], "goal_reached": goal,
                      "n_elements": dom["count"]})
        if goal >= pass_threshold:
            return {"verdict": "PASS", "goal_reached": goal, "steps": step, "trace": trace}
        # not there yet -> tap Jev's chosen element
        choice = ans["target_element"]["choice"]
        if choice == "-1":
            break
        tgt = next((e for e in dom["els"] if e["i"] == int(choice)), None)
        if not tgt:
            break
        trace[-1]["tapped"] = tgt["text"]
        tap_text(tgt["text"])
        time.sleep(1.2)
    final = trace[-1]["goal_reached"] if trace else 0.0
    return {"verdict": "FAIL" if final < 0.3 else "UNCERTAIN",
            "goal_reached": final, "steps": len(trace), "trace": trace}


SCENARIOS = [
    {"scenario": "Launch the app and verify the budget dashboard renders with navigation and financial summary metrics.",
     "success_true": "Budget dashboard with Dashboard/Transactions nav and Expenses/Income/Net metrics is shown",
     "success_false": "Blank, error, loading, or only a system/permission screen"},
    {"scenario": "Navigate to the Transactions screen where the user can see and add transactions.",
     "success_true": "Transactions screen with a transaction list/empty-state and add/import controls is shown",
     "success_false": "Any other screen"},
]


def main():
    key = load_key()
    assert len(key) > 20, "TYPESAFE_API_KEY not loaded"
    # ensure app foreground
    _adb("adb shell am start -n com.treasuryscribe.app/.MainActivity >/dev/null 2>&1")
    time.sleep(3)
    results = []
    for sc in SCENARIOS:
        r = run_scenario(sc["scenario"], sc["success_true"], sc["success_false"], key)
        results.append({"scenario": sc["scenario"], **r})
        print(f"[{r['verdict']:9}] goal={r['goal_reached']:.2f} steps={r['steps']}  {sc['scenario']}")
    n_pass = sum(1 for r in results if r["verdict"] == "PASS")
    print(f"\n{n_pass}/{len(results)} scenarios PASSED")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
