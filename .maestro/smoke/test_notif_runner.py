"""Unit tests for notif_runner pure logic (no device). Run: python -m unittest test_notif_runner"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yaml
import notif_runner as nr

NB = "\u00a0"


class ParseRow(unittest.TestCase):
    def test_five_children_amount(self):
        r = nr.parse_row({"n": 5, "title": "OBI", "body": "b", "amountText": "1599 HUF"})
        self.assertEqual((r["amount"], r["currency"]), (1599.0, "HUF"))

    def test_decimal_amount(self):
        self.assertEqual(nr.parse_row({"n": 5, "title": "", "body": "", "amountText": "6639.22 HUF"})["amount"], 6639.22)

    def test_four_children_null_amount(self):
        r = nr.parse_row({"n": 4, "title": "", "body": ""})
        self.assertIsNone(r["amount"])
        self.assertTrue(r["currency_not_rendered"])

    def test_bad_child_count(self):
        self.assertIn("error", nr.parse_row({"n": 3}))

    def test_unparseable_amount(self):
        self.assertIn("error", nr.parse_row({"n": 5, "amountText": "1 599 Ft"}))


class DiffRows(unittest.TestCase):
    E = {"title": "OBI", "body": f"1{NB}599", "amount": 1599, "currency": "HUF"}

    def test_equal(self):
        self.assertEqual(nr.diff_rows([self.E], [dict(self.E, amount=1599.0)]), ([], []))

    def test_multiplicity_matters(self):
        missing, extra = nr.diff_rows([self.E], [self.E, self.E])
        self.assertEqual((missing, len(extra)), ([], 1))

    def test_nbsp_not_equal_space(self):
        missing, _ = nr.diff_rows([self.E], [dict(self.E, body="1 599")])
        self.assertEqual(len(missing), 1)

    def test_null_amount_ignores_currency(self):
        e = {"title": "", "body": "", "amount": None, "currency": "HUF"}
        self.assertEqual(nr.diff_rows([e], [{"title": "", "body": "", "amount": None, "currency": None}]), ([], []))

    def test_wrong_amount_reported(self):
        missing, extra = nr.diff_rows([self.E], [dict(self.E, amount=249.55)])
        self.assertEqual((len(missing), extra[0]["amount"]), (1, 249.55))


class Timing(unittest.TestCase):
    def test_max_delta(self):
        posts = [{"postTime": 0}, {"postTime": 4500}]
        self.assertIsNotNone(nr.check_timing({"max_post_delta_s": 4.0}, posts))
        self.assertIsNone(nr.check_timing({"max_post_delta_s": 5.0}, posts))

    def test_min_delta(self):
        self.assertIsNotNone(nr.check_timing({"min_post_delta_s": 5.0001}, [{"postTime": 0}, {"postTime": 5000}]))


class Suite(unittest.TestCase):
    def test_suite_valid(self):
        with open(nr.SCENARIOS, encoding="utf-8") as f:
            spec = yaml.safe_load(f)
        self.assertEqual(nr.validate(spec), [])
        self.assertEqual(len(spec["scenarios"]), 21)
        self.assertTrue(all(s.get("hint") for s in spec["scenarios"]))

    def test_nbsp_decoded(self):
        with open(nr.SCENARIOS, encoding="utf-8") as f:
            spec = yaml.safe_load(f)
        post = spec["scenarios"][0]["nav"][4]["post_notification"]
        self.assertIn(NB, post["body"])

    def test_otp_like_payload_rejected(self):
        bad = {"scenarios": [{"id": "X", "nav": ["reset_app", {"post_notification": {"id": 1, "body": "1000 Ft"}}]}]}
        self.assertTrue(any("OTP" in e for e in nr.validate(bad)))

    def test_unknown_op_rejected(self):
        bad = {"scenarios": [{"id": "X", "nav": ["reset_app", {"tap_text": "a"}], "code_assert": {"bogus": 1}}]}
        errs = nr.validate(bad)
        self.assertTrue(any("tap_text" in e for e in errs) and any("bogus" in e for e in errs))

    def test_serial_guard(self):
        old = nr.SERIAL
        nr.SERIAL = "527f58ac"
        try:
            with self.assertRaises(nr.HarnessError):
                nr.adb("devices")
        finally:
            nr.SERIAL = old


if __name__ == "__main__":
    unittest.main()
