"""
fix_hungarian_csv.py
────────────────────
Repairs mojibake in a Revolut-style Hungarian account-statement CSV.

Root cause
──────────
The file is valid UTF-8 with BOM, but its content is double-encoded:
  UTF-8 bytes → wrongly decoded as Windows-1252 → re-saved as UTF-8
This turns two-byte sequences (e.g. é = C3 A9) into three- or four-byte
garbage (e.g. Ă© = C4 82 C2 A9).  The `ftfy` library detects and reverses
this transformation automatically.

Output
──────
A UTF-8 with BOM file — the correct encoding for Hungarian content that
should be openable in Excel without a manual import step.
"""

from __future__ import annotations

import sys
from pathlib import Path

import ftfy


# ── I/O helpers ──────────────────────────────────────────────────────────────

def read_raw_text(path: Path) -> str:
    """Read file as UTF-8 with BOM, preserving every original character."""
    return path.read_text(encoding="utf-8-sig")


def write_utf8_bom(path: Path, text: str) -> None:
    """Write text as UTF-8 with BOM so Excel opens it correctly."""
    path.write_text(text, encoding="utf-8-sig")


# ── Core fix ─────────────────────────────────────────────────────────────────

def fix_mojibake(text: str) -> str:
    """
    Apply ftfy to the *entire* raw CSV text at once.

    Applying ftfy per-cell (after pandas splits the CSV) fails for short
    strings — the heuristic confidence score doesn't reach the threshold.
    Passing the whole file as one string gives ftfy enough context.
    """
    return ftfy.fix_text(text)


# ── Pipeline ─────────────────────────────────────────────────────────────────

def convert(source: Path, destination: Path) -> None:
    raw_text = read_raw_text(source)
    fixed_text = fix_mojibake(raw_text)
    write_utf8_bom(destination, fixed_text)
    print(f"Fixed file written to: {destination}")


# ── Verification ─────────────────────────────────────────────────────────────

def verify(path: Path) -> None:
    """
    Spot-check the output: print headers and the first three data rows.
    If Hungarian letters are missing, something is still wrong.
    """
    import csv

    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = [row for _, row in zip(range(4), reader)]

    print("\nVerification — headers and first 3 rows:")
    for row in rows:
        print("  ", row)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python fix_hungarian_csv.py <input.csv> [output.csv]")
        sys.exit(1)

    source = Path(sys.argv[1])
    destination = Path(sys.argv[2]) if len(sys.argv) > 2 else source.with_stem(source.stem + "_fixed")

    convert(source, destination)
    verify(destination)


if __name__ == "__main__":
    main()
