#!/usr/bin/env python3
"""
cdp.py — deterministic CDP DOM primitives for the Treasury Scribe WebView.

Pure code, no model calls. Re-resolves the WebView devtools socket on every
call (the socket PID changes when the WebView respawns) and forwards it to a
local port. Exposes: extract_dom, eval_js, tap_text, tap_testid, set_input,
press_key, launch, nav helpers. The harness composes these into deterministic
navigation; Jev is only consulted for semantic yes/no assertions (see jev.py).

Env: sourced from the android-env.sh next to this file (JAVA_HOME/ANDROID_HOME
/PATH for adb). Override APP_ID / LOCAL_PORT via env if needed.
"""
import asyncio, json, os, subprocess, time
import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_SH = os.path.join(HERE, "android-env.sh")
APP_ID = os.environ.get("TS_APP_ID", "com.treasuryscribe.app")
MAIN_ACTIVITY = f"{APP_ID}/.MainActivity"
LOCAL_PORT = int(os.environ.get("TS_CDP_PORT", "9333"))


def _adb(cmd: str) -> str:
    """Run an adb/shell command with the repo-local android env sourced."""
    src = f'[ -f "{ENV_SH}" ] && source "{ENV_SH}"; ' if os.path.exists(ENV_SH) else ""
    return subprocess.run(["bash", "-c", src + cmd], capture_output=True, text=True).stdout


def adb(cmd: str) -> str:
    return _adb(cmd)


def live_ws() -> str:
    """Re-resolve the current WebView CDP socket, forward it, return page WS url."""
    _adb("adb forward --remove-all 2>/dev/null >/dev/null")
    sock = _adb(
        "adb shell cat /proc/net/unix | grep -oE 'webview_devtools_remote_[0-9]+' | head -1"
    ).strip()
    if not sock:
        raise RuntimeError("No WebView devtools socket. Is the app foregrounded (debug build)?")
    _adb(f"adb forward tcp:{LOCAL_PORT} localabstract:{sock} >/dev/null")
    listing = _adb(f"curl -s -m5 http://127.0.0.1:{LOCAL_PORT}/json/list")
    pages = [t for t in json.loads(listing) if t.get("type") == "page"]
    if not pages:
        raise RuntimeError("No CDP page target found.")
    return pages[0]["webSocketDebuggerUrl"]


async def _eval(expr: str):
    async with websockets.connect(live_ws(), max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        await ws.recv()
        await ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate",
                                  "params": {"expression": expr, "returnByValue": True,
                                             "awaitPromise": True}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == 2:
                res = m.get("result", {})
                if res.get("exceptionDetails"):
                    raise RuntimeError(f"JS exception: {res['exceptionDetails']}")
                return res.get("result", {}).get("value")


def eval_js(expr: str):
    return asyncio.run(_eval(expr))


# --- distilled DOM extraction (interactive els + leaf text + testids) --------
DISTILL_JS = r"""
(() => {
  const out=[]; let idx=0;
  const vis=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';};
  const seen=new Set();
  document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=tab],[role=link],[onclick],[tabindex]').forEach(el=>{
    if(!vis(el))return; const r=el.getBoundingClientRect();
    out.push({i:idx++,kind:'interactive',tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||null,
      type:el.getAttribute('type')||null,testid:el.getAttribute('data-testid')||null,
      text:(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim().slice(0,80),
      box:[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]});
    seen.add(el);});
  document.querySelectorAll('h1,h2,h3,h4,label,span,p,div').forEach(el=>{
    if(seen.has(el)||el.children.length>0||!vis(el))return;
    const t=(el.innerText||'').trim(); if(!t||t.length>80)return;
    out.push({i:idx++,kind:'text',tag:el.tagName.toLowerCase(),testid:el.getAttribute('data-testid')||null,text:t.slice(0,80)});});
  return JSON.stringify({title:document.title,url:location.href,count:out.length,els:out});
})()
"""


def extract_dom() -> dict:
    return json.loads(eval_js(DISTILL_JS))


def testids(dom: dict) -> list:
    return [e["testid"] for e in dom["els"] if e.get("testid")]


# --- deterministic interactions ---------------------------------------------
def tap_testid(testid: str) -> bool:
    js = ("(()=>{const el=document.querySelector('[data-testid=\"' + %s + '\"]');"
          "if(!el)return false;el.click();return true;})()" % json.dumps(testid))
    return bool(eval_js(js))


def tap_text(text: str) -> bool:
    safe = json.dumps(text)
    js = ("(() => {const want=" + safe + ";"
          "const c=[...document.querySelectorAll('a,button,[role=button],[role=tab],span,div')]"
          ".filter(el=>el.getBoundingClientRect().width>0 && (el.innerText||'').trim()===want);"
          "if(!c.length) return false;"
          "c.sort((a,b)=>{const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();"
          "return ra.width*ra.height-rb.width*rb.height;});"
          "c[0].click(); return true;})()")
    return bool(eval_js(js))


def set_input(placeholder_or_testid: str, value: str) -> bool:
    """Set a React-controlled input/textarea by placeholder, aria-label, or data-testid."""
    js = r"""
(() => {
  const key=%s, val=%s;
  const el=[...document.querySelectorAll('input,textarea')].find(e=>
    (e.placeholder||'').trim()===key || (e.getAttribute('aria-label')||'').trim()===key ||
    (e.getAttribute('data-testid')||'')===key);
  if(!el) return false;
  const proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, val);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})()""" % (json.dumps(placeholder_or_testid), json.dumps(value))
    return bool(eval_js(js))


def press_key(keyevent: str) -> None:
    """Android system key, e.g. KEYCODE_BACK."""
    _adb(f"adb shell input keyevent {keyevent}")


def launch() -> None:
    _adb(f"adb shell am start -n {MAIN_ACTIVITY} >/dev/null 2>&1")


def device_online() -> bool:
    out = _adb("adb shell getprop sys.boot_completed").strip()
    return out == "1"
