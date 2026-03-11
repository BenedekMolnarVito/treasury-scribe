"""
transform_csv.py

Transforms exported transaction CSV files into a condensed 5-column format.

Input CSV format (one file or more in csv_transformer_service/):
    Id, ReceivedAt, NotificationTitle, NotificationBody, PackageName,
    Amount, Currency, IsCash, Tags, IsDeleted

Output CSV format (written to csv_transformer_service/outputs/):
    Nap, Megnevezés, Tag, Kiadás, Currency

Amount logic:
  - Use the ``Amount`` column when non-empty.
  - Otherwise extract the first number immediately followed by ``Ft``
    from ``NotificationBody`` using a regular expression.

Date format: ``YYYY.MM.DD``  (taken from the ``ReceivedAt`` ISO 8601 value).

Usage::

    python transform_csv.py

Runs under Python 3.6+ with zero external dependencies.
"""

import csv
import os
import re
import sys


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Columns expected in the input CSV.
INPUT_HEADERS = [
    "Id",
    "ReceivedAt",
    "NotificationTitle",
    "NotificationBody",
    "PackageName",
    "Amount",
    "Currency",
    "IsCash",
    "Tags",
    "IsDeleted",
]

# Columns produced in the output CSV.
OUTPUT_HEADERS = ["Nap", "Megnevezés", "Tag", "Kiadás", "Currency"]

# Regex: match the first integer or decimal number that is directly followed
# (possibly with whitespace) by the literal token ``Ft``.
# Examples:  "6 337 Ft"  "1234Ft"  "10 000,50 Ft"
_FT_REGEX = re.compile(
    r"(\d[\d\s.,]*?)\s*Ft",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_date(received_at: str) -> str:
    """Return the date part of an ISO 8601 timestamp in ``YYYY.MM.DD`` format.

    Args:
        received_at: ISO 8601 UTC string, e.g. ``"2024-06-01T12:00:00.000Z"``.

    Returns:
        Date string formatted as ``"2024.06.01"``, or the original value
        unchanged when it cannot be parsed.
    """
    # ISO 8601 dates start with YYYY-MM-DD, so we can split on T or space.
    date_part = received_at.split("T")[0].split(" ")[0]
    parts = date_part.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return "{}.{}.{}".format(parts[0], parts[1], parts[2])
    return received_at


def extract_amount(amount_col: str, notification_body: str) -> str:
    """Resolve the monetary amount for a transaction row.

    Rules:
    1. If *amount_col* is non-empty and non-whitespace, return it as-is.
    2. Otherwise, apply the ``Ft`` regex to *notification_body* and return
       the first match (digits only, without whitespace or punctuation).
    3. If neither source yields a value, return an empty string.

    Args:
        amount_col:        Raw value of the ``Amount`` CSV column.
        notification_body: Raw value of the ``NotificationBody`` CSV column.

    Returns:
        String representation of the amount, or ``""`` when not found.
    """
    stripped = amount_col.strip()
    if stripped and stripped.lower() not in ("none", "null"):
        return stripped

    if notification_body:
        match = _FT_REGEX.search(notification_body)
        if match:
            # Remove internal whitespace and commas used as thousand separators.
            raw = match.group(1).replace(" ", "").replace(",", "")
            return raw

    return ""


def transform_row(row: dict) -> dict:
    """Convert one input CSV row into one output CSV row.

    Args:
        row: Dict with keys matching :data:`INPUT_HEADERS`.

    Returns:
        Dict with keys matching :data:`OUTPUT_HEADERS`.
    """
    nap = parse_date(row.get("ReceivedAt", ""))
    megnevezes = row.get("NotificationTitle", "")
    tag = row.get("Tags", "")
    kiad = extract_amount(
        row.get("Amount", ""),
        row.get("NotificationBody", ""),
    )
    currency = row.get("Currency", "")

    return {
        "Nap": nap,
        "Megnevezés": megnevezes,
        "Tag": tag,
        "Kiadás": kiad,
        "Currency": currency,
    }


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def transform_file(input_path: str, output_path: str) -> int:
    """Read *input_path*, transform every row, write to *output_path*.

    Args:
        input_path:  Path to the source ``.csv`` file.
        output_path: Path where the transformed ``.csv`` will be written.

    Returns:
        Number of data rows written (excluding the header).
    """
    rows_written = 0

    with open(input_path, newline="", encoding="utf-8") as in_fh:
        reader = csv.DictReader(in_fh)
        transformed_rows = [transform_row(row) for row in reader]

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8") as out_fh:
        writer = csv.DictWriter(out_fh, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        for out_row in transformed_rows:
            writer.writerow(out_row)
            rows_written += 1

    return rows_written


def find_input_files(directory: str) -> list:
    """Return all ``.csv`` files directly inside *directory* (non-recursive).

    The ``outputs`` sub-directory is excluded to avoid re-processing output
    files.

    Args:
        directory: Path to the folder to scan.

    Returns:
        Sorted list of absolute ``.csv`` file paths.
    """
    outputs_dir = os.path.join(directory, "outputs")
    result = []
    for entry in os.listdir(directory):
        if not entry.lower().endswith(".csv"):
            continue
        full = os.path.join(directory, entry)
        if os.path.isfile(full) and not full.startswith(outputs_dir):
            result.append(full)
    return sorted(result)


def run(base_dir: str) -> None:
    """Discover and transform all ``.csv`` files under *base_dir*.

    Transformed files are written to ``<base_dir>/outputs/`` with the same
    filename as the source file.

    Args:
        base_dir: Root directory of ``csv_transformer_service/``.
    """
    input_files = find_input_files(base_dir)

    if not input_files:
        print("No CSV files found in {}.".format(base_dir))
        return

    outputs_dir = os.path.join(base_dir, "outputs")
    os.makedirs(outputs_dir, exist_ok=True)

    for input_path in input_files:
        filename = os.path.basename(input_path)
        output_path = os.path.join(outputs_dir, filename)
        n = transform_file(input_path, output_path)
        print("Transformed {} -> {} ({} rows)".format(filename, output_path, n))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # When invoked directly the script runs from the directory it lives in.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    run(script_dir)
    sys.exit(0)
