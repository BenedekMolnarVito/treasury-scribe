#!/usr/bin/env python3
"""
jev.py — TypeSafe Jev (System One) client for BATCHED yes/no assertions.

Jev is used ONLY for semantic yes/no judgments over a captured screen state
(e.g. "is this a weekly-trend chart?"). It is NEVER used for planning, choosing
the next action, or producing text — the harness owns the deterministic flow.

Batching (the whole point): every assertion in a scenario is sent as one Noul in
a SINGLE request's `questions` map over the SAME screen state. TypeSafe evaluates
them in parallel and returns one answer per id (see docs: /primitives/noul,
/cookbooks/parallel_questions). This makes each scenario exactly one fast, cheap
API round-trip regardless of how many assertions it has.

Key: TYPESAFE_API_KEY (env, else sourced from ~/.zshrc).
"""
import json, os, subprocess, time, urllib.request, urllib.error

TYPESAFE_URL = os.environ.get("TYPESAFE_URL", "https://api.typesafe.ai/v1/systemone")
JEV_MODEL = os.environ.get("TS_JEV_MODEL", "jev-latest")


def load_key() -> str:
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k.strip()
    r = subprocess.run(
        ["zsh", "-c", "source ~/.zshrc >/dev/null 2>&1; printf '%s\\0' \"$TYPESAFE_API_KEY\""],
        capture_output=True,
    )
    return r.stdout.split(b"\0")[0].decode().strip()


def _post(body: dict, key: str) -> dict:
    req = urllib.request.Request(
        TYPESAFE_URL, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("Jev request failed after retries")


def batch_nouls(state: dict, asserts: list, key: str) -> dict:
    """
    One request, many Nouls over the same `state`.

    `asserts`: list of {"id", "question", "true", "false"} dicts.
    Returns {id: probability_float} for every assertion.
    """
    questions = {}
    for a in asserts:
        q = {"type": "noul", "instructions": a["question"]}
        if a.get("true") or a.get("false"):
            q["criteria"] = {"true": a.get("true", ""), "false": a.get("false", "")}
        questions[a["id"]] = q
    resp = _post({"state": state, "model": JEV_MODEL, "questions": questions}, key)
    answers = resp.get("answers", {})
    out = {aid: float(answers[aid]["noul"]) for aid in questions if aid in answers}
    out["_usage"] = resp.get("usage", {})
    return out
