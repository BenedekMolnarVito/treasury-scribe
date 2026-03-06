"""
test_transform_csv.py

Unit tests for csv_transformer_service/transform_csv.py.

Run with::

    python -m pytest csv_transformer_service/test_transform_csv.py -v

or simply::

    python csv_transformer_service/test_transform_csv.py

No external dependencies required (uses the stdlib ``unittest`` module).
"""

import csv
import io
import os
import sys
import tempfile
import unittest

# Ensure the csv_transformer_service directory is importable regardless of
# where the test runner is invoked from.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from transform_csv import (  # noqa: E402
    extract_amount,
    find_input_files,
    parse_date,
    run,
    transform_file,
    transform_row,
)


# ---------------------------------------------------------------------------
# parse_date
# ---------------------------------------------------------------------------


class TestParseDate(unittest.TestCase):
    """Tests for :func:`parse_date`."""

    def test_iso_utc_string(self):
        self.assertEqual(parse_date("2024-06-01T12:00:00.000Z"), "2024.06.01")

    def test_iso_without_time(self):
        self.assertEqual(parse_date("2024-12-31"), "2024.12.31")

    def test_single_digit_month_and_day(self):
        self.assertEqual(parse_date("2023-01-05T00:00:00Z"), "2023.01.05")

    def test_space_separated_datetime(self):
        self.assertEqual(parse_date("2024-06-01 08:30:00"), "2024.06.01")

    def test_unparseable_returns_original(self):
        self.assertEqual(parse_date("not-a-date"), "not-a-date")

    def test_empty_string(self):
        # An empty string splits into one element; we return the original.
        result = parse_date("")
        self.assertIsInstance(result, str)


# ---------------------------------------------------------------------------
# extract_amount
# ---------------------------------------------------------------------------


class TestExtractAmount(unittest.TestCase):
    """Tests for :func:`extract_amount`."""

    # --- Amount column present ---

    def test_uses_amount_column_when_present(self):
        self.assertEqual(extract_amount("1500", "Paid 999 Ft"), "1500")

    def test_amount_column_with_decimal(self):
        self.assertEqual(extract_amount("1234.56", ""), "1234.56")

    def test_amount_column_whitespace_stripped(self):
        self.assertEqual(extract_amount("  750  ", ""), "750")

    def test_amount_column_none_string_falls_back(self):
        result = extract_amount("None", "kapott 6337 Ft összeg")
        self.assertEqual(result, "6337")

    def test_amount_column_null_string_falls_back(self):
        result = extract_amount("null", "kapott 100 Ft")
        self.assertEqual(result, "100")

    def test_empty_amount_falls_back_to_body(self):
        result = extract_amount("", "Vásárlás: 5 000 Ft")
        self.assertEqual(result, "5000")

    # --- Extracting from NotificationBody ---

    def test_ft_without_spaces(self):
        self.assertEqual(extract_amount("", "Total: 1234Ft"), "1234")

    def test_ft_with_leading_space(self):
        self.assertEqual(extract_amount("", "6 337 Ft jóváírva"), "6337")

    def test_ft_with_comma_thousands(self):
        self.assertEqual(extract_amount("", "10,500Ft"), "10500")

    def test_ft_case_insensitive(self):
        self.assertEqual(extract_amount("", "összeg: 800ft"), "800")

    def test_first_ft_occurrence_used(self):
        # "500 Ft" comes before "200 Ft"
        self.assertEqual(extract_amount("", "500 Ft vs 200 Ft"), "500")

    def test_no_ft_in_body_returns_empty(self):
        self.assertEqual(extract_amount("", "No amount here"), "")

    def test_empty_body_returns_empty(self):
        self.assertEqual(extract_amount("", ""), "")


# ---------------------------------------------------------------------------
# transform_row
# ---------------------------------------------------------------------------


class TestTransformRow(unittest.TestCase):
    """Tests for :func:`transform_row`."""

    def _make_row(self, **overrides):
        base = {
            "Id": "1",
            "ReceivedAt": "2024-06-01T08:00:00.000Z",
            "NotificationTitle": "Supermarket",
            "NotificationBody": "Paid 1500 Ft",
            "PackageName": "com.example",
            "Amount": "1500",
            "Currency": "HUF",
            "IsCash": "0",
            "Tags": "food;grocery",
            "IsDeleted": "0",
        }
        base.update(overrides)
        return base

    def test_nap_format(self):
        row = transform_row(self._make_row())
        self.assertEqual(row["Nap"], "2024.06.01")

    def test_megnevezes_is_notification_title(self):
        row = transform_row(self._make_row(NotificationTitle="Café"))
        self.assertEqual(row["Megnevezés"], "Café")

    def test_tag_is_tags_column(self):
        row = transform_row(self._make_row(Tags="food;grocery"))
        self.assertEqual(row["Tag"], "food;grocery")

    def test_kiadas_uses_amount_column(self):
        row = transform_row(self._make_row(Amount="750"))
        self.assertEqual(row["Kiadás"], "750")

    def test_kiadas_falls_back_to_body(self):
        row = transform_row(
            self._make_row(Amount="", NotificationBody="összeg 3 000 Ft")
        )
        self.assertEqual(row["Kiadás"], "3000")

    def test_currency_passed_through(self):
        row = transform_row(self._make_row(Currency="EUR"))
        self.assertEqual(row["Currency"], "EUR")

    def test_output_has_exactly_output_headers(self):
        row = transform_row(self._make_row())
        self.assertEqual(set(row.keys()), {"Nap", "Megnevezés", "Tag", "Kiadás", "Currency"})


# ---------------------------------------------------------------------------
# transform_file  (integration – uses temp files)
# ---------------------------------------------------------------------------


def _write_csv(path, rows, headers=None):
    """Write a list of dicts to *path* as CSV."""
    if not rows:
        headers = headers or []
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=headers)
            writer.writeheader()
        return
    fieldnames = headers or list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _read_csv(path):
    """Return a list of dicts from *path*."""
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


class TestTransformFile(unittest.TestCase):
    """Tests for :func:`transform_file`."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _input_path(self, name="transactions.csv"):
        return os.path.join(self._tmpdir, name)

    def _output_path(self, name="transactions.csv"):
        return os.path.join(self._tmpdir, "outputs", name)

    def test_writes_correct_headers(self):
        rows = [
            {
                "Id": "1",
                "ReceivedAt": "2024-01-15T10:00:00Z",
                "NotificationTitle": "Test",
                "NotificationBody": "100 Ft",
                "PackageName": "com.example",
                "Amount": "100",
                "Currency": "HUF",
                "IsCash": "0",
                "Tags": "",
                "IsDeleted": "0",
            }
        ]
        inp = self._input_path()
        out = self._output_path()
        _write_csv(inp, rows)
        transform_file(inp, out)
        result = _read_csv(out)
        self.assertEqual(list(result[0].keys()), ["Nap", "Megnevezés", "Tag", "Kiadás", "Currency"])

    def test_returns_row_count(self):
        rows = [
            {
                "Id": str(i),
                "ReceivedAt": "2024-01-01T00:00:00Z",
                "NotificationTitle": "T{}".format(i),
                "NotificationBody": "",
                "PackageName": "",
                "Amount": str(i * 10),
                "Currency": "HUF",
                "IsCash": "0",
                "Tags": "",
                "IsDeleted": "0",
            }
            for i in range(3)
        ]
        inp = self._input_path()
        out = self._output_path()
        _write_csv(inp, rows)
        n = transform_file(inp, out)
        self.assertEqual(n, 3)

    def test_nap_column_format(self):
        rows = [
            {
                "Id": "1",
                "ReceivedAt": "2023-07-04T15:30:00.000Z",
                "NotificationTitle": "Holiday",
                "NotificationBody": "",
                "PackageName": "",
                "Amount": "500",
                "Currency": "USD",
                "IsCash": "1",
                "Tags": "holiday",
                "IsDeleted": "0",
            }
        ]
        inp = self._input_path()
        out = self._output_path()
        _write_csv(inp, rows)
        transform_file(inp, out)
        result = _read_csv(out)
        self.assertEqual(result[0]["Nap"], "2023.07.04")

    def test_amount_fallback_from_body(self):
        rows = [
            {
                "Id": "2",
                "ReceivedAt": "2024-03-10T09:00:00Z",
                "NotificationTitle": "Store",
                "NotificationBody": "Vásárlás: 4 500 Ft",
                "PackageName": "",
                "Amount": "",
                "Currency": "HUF",
                "IsCash": "0",
                "Tags": "",
                "IsDeleted": "0",
            }
        ]
        inp = self._input_path()
        out = self._output_path()
        _write_csv(inp, rows)
        transform_file(inp, out)
        result = _read_csv(out)
        self.assertEqual(result[0]["Kiadás"], "4500")

    def test_semicolon_tags_preserved(self):
        rows = [
            {
                "Id": "3",
                "ReceivedAt": "2024-06-01T12:00:00Z",
                "NotificationTitle": "Tagged",
                "NotificationBody": "",
                "PackageName": "",
                "Amount": "200",
                "Currency": "EUR",
                "IsCash": "0",
                "Tags": "food;shopping",
                "IsDeleted": "0",
            }
        ]
        inp = self._input_path()
        out = self._output_path()
        _write_csv(inp, rows)
        transform_file(inp, out)
        result = _read_csv(out)
        self.assertEqual(result[0]["Tag"], "food;shopping")

    def test_creates_output_directory(self):
        rows = [
            {
                "Id": "1",
                "ReceivedAt": "2024-01-01T00:00:00Z",
                "NotificationTitle": "T",
                "NotificationBody": "",
                "PackageName": "",
                "Amount": "1",
                "Currency": "HUF",
                "IsCash": "0",
                "Tags": "",
                "IsDeleted": "0",
            }
        ]
        inp = self._input_path()
        out = self._output_path()
        self.assertFalse(os.path.exists(os.path.dirname(out)))
        _write_csv(inp, rows)
        transform_file(inp, out)
        self.assertTrue(os.path.exists(out))


# ---------------------------------------------------------------------------
# find_input_files
# ---------------------------------------------------------------------------


class TestFindInputFiles(unittest.TestCase):
    """Tests for :func:`find_input_files`."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _touch(self, rel_path):
        full = os.path.join(self._tmpdir, rel_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as fh:
            fh.write("")
        return full

    def test_finds_csv_files(self):
        self._touch("a.csv")
        self._touch("b.csv")
        files = find_input_files(self._tmpdir)
        basenames = [os.path.basename(f) for f in files]
        self.assertIn("a.csv", basenames)
        self.assertIn("b.csv", basenames)

    def test_excludes_non_csv(self):
        self._touch("notes.txt")
        self._touch("data.csv")
        files = find_input_files(self._tmpdir)
        basenames = [os.path.basename(f) for f in files]
        self.assertNotIn("notes.txt", basenames)
        self.assertIn("data.csv", basenames)

    def test_excludes_outputs_directory(self):
        self._touch("outputs/transformed.csv")
        files = find_input_files(self._tmpdir)
        for f in files:
            self.assertNotIn("outputs", f)

    def test_returns_sorted(self):
        self._touch("z.csv")
        self._touch("a.csv")
        files = find_input_files(self._tmpdir)
        self.assertEqual(files, sorted(files))

    def test_empty_directory(self):
        files = find_input_files(self._tmpdir)
        self.assertEqual(files, [])


# ---------------------------------------------------------------------------
# run (end-to-end)
# ---------------------------------------------------------------------------


class TestRun(unittest.TestCase):
    """End-to-end tests for :func:`run`."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _write_input(self, filename, rows):
        path = os.path.join(self._tmpdir, filename)
        _write_csv(path, rows)
        return path

    def test_processes_all_csv_files(self):
        row_proto = {
            "Id": "1",
            "ReceivedAt": "2024-01-01T00:00:00Z",
            "NotificationTitle": "T",
            "NotificationBody": "",
            "PackageName": "",
            "Amount": "10",
            "Currency": "HUF",
            "IsCash": "0",
            "Tags": "",
            "IsDeleted": "0",
        }
        self._write_input("file1.csv", [dict(row_proto, Id="1")])
        self._write_input("file2.csv", [dict(row_proto, Id="2")])

        run(self._tmpdir)

        outputs_dir = os.path.join(self._tmpdir, "outputs")
        self.assertTrue(os.path.exists(os.path.join(outputs_dir, "file1.csv")))
        self.assertTrue(os.path.exists(os.path.join(outputs_dir, "file2.csv")))

    def test_output_has_correct_headers(self):
        row = {
            "Id": "1",
            "ReceivedAt": "2024-06-15T12:00:00Z",
            "NotificationTitle": "Lunch",
            "NotificationBody": "1200 Ft",
            "PackageName": "",
            "Amount": "1200",
            "Currency": "HUF",
            "IsCash": "0",
            "Tags": "food",
            "IsDeleted": "0",
        }
        self._write_input("lunch.csv", [row])
        run(self._tmpdir)

        out_path = os.path.join(self._tmpdir, "outputs", "lunch.csv")
        result = _read_csv(out_path)
        self.assertEqual(list(result[0].keys()), ["Nap", "Megnevezés", "Tag", "Kiadás", "Currency"])

    def test_no_csv_files_does_not_crash(self):
        # Should just print a message and return without errors.
        try:
            run(self._tmpdir)
        except Exception as exc:  # pragma: no cover
            self.fail("run() raised unexpectedly: {}".format(exc))


if __name__ == "__main__":
    unittest.main(verbosity=2)
